package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"
)

var arithmeticKey = regexp.MustCompile(`^(\d+)([+-])(\d+)$`)
var bondKey = regexp.MustCompile(`^(\d+):(\d+):(\d+):(decomp|compose):(010|001|100)$`)

type mathQuestionResult struct {
	Key         string `json:"key"`
	KnowledgeID string `json:"knowledgeId"`
	Correct     *bool  `json:"correct"`
	Day         string `json:"day,omitempty"`
	At          string `json:"at,omitempty"`
}

type mathKnowledge struct {
	ID               string `json:"id"`
	Type             string `json:"type"`
	Stage            int    `json:"stage"`
	NextReview       string `json:"nextReview"`
	ReviewDay        string `json:"reviewDay"`
	ReviewStartStage int    `json:"reviewStartStage"`
	LastResult       string `json:"lastResult"`
	Attempts         int    `json:"attempts"`
	Mistakes         int    `json:"mistakes"`
	LastCorrect      bool   `json:"lastCorrect"`
	LastSeenAt       string `json:"lastSeenAt"`
}

func validMathKnowledge(kind, key, id string) bool {
	if kind == "math" {
		match := arithmeticKey.FindStringSubmatch(key)
		if match == nil {
			return false
		}
		a, _ := strconv.Atoi(match[1])
		b, _ := strconv.Atoi(match[3])
		if a > 10 || b > 10 {
			return false
		}
		if match[2] == "+" {
			return a+b <= 10 && id == fmt.Sprintf("add-total-%d", a+b)
		}
		return a >= b && id == fmt.Sprintf("sub-whole-%d", a)
	}
	if kind != "decomp" {
		return false
	}
	match := bondKey.FindStringSubmatch(key)
	if match == nil {
		return false
	}
	n, _ := strconv.Atoi(match[1])
	left, _ := strconv.Atoi(match[2])
	right, _ := strconv.Atoi(match[3])
	if n < 2 || n > 10 || left+right != n {
		return false
	}
	if match[4] == "compose" {
		return match[5] == "100" && id == fmt.Sprintf("bond-whole-%d", n)
	}
	return (match[5] == "010" || match[5] == "001") && id == fmt.Sprintf("bond-part-%d", n)
}

func validateMathResults(kind string, details map[string]any) error {
	raw, exists := details["questionResults"]
	if !exists {
		return nil
	} // Retain older completed-round clients.
	invalid := func() error {
		return gardenError(http.StatusBadRequest, "invalid_study_group", "数学逐题首次结果与题目或总分不一致")
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return invalid()
	}
	var results []mathQuestionResult
	if json.Unmarshal(encoded, &results) != nil || len(results) < 1 || len(results) > 10 {
		return invalid()
	}
	encoded, _ = json.Marshal(details["questionKeys"])
	var keys []string
	_ = json.Unmarshal(encoded, &keys)
	encoded, _ = json.Marshal(details["correct"])
	var correct int
	if json.Unmarshal(encoded, &correct) != nil {
		return invalid()
	}
	if len(results) != len(keys) {
		return invalid()
	}
	count := 0
	seen := map[string]bool{}
	for index, result := range results {
		if result.Correct == nil || index >= len(keys) || result.Key != keys[index] || seen[result.Key] || !validMathKnowledge(kind, result.Key, result.KnowledgeID) {
			return invalid()
		}
		seen[result.Key] = true
		if *result.Correct {
			count++
		}
	}
	if count != correct {
		return invalid()
	}
	return nil
}

func updateMathKnowledge(item map[string]json.RawMessage, entry studyEntry, kind string) error {
	if kind != "math" && kind != "decomp" {
		return nil
	}
	raw, exists := entry.Details["questionResults"]
	if !exists {
		return nil
	}
	encoded, _ := json.Marshal(raw)
	var results []mathQuestionResult
	if err := json.Unmarshal(encoded, &results); err != nil {
		return err
	}
	knowledge := map[string]mathKnowledge{}
	if raw, exists := item["mathKnowledge"]; exists {
		if err := json.Unmarshal(raw, &knowledge); err != nil {
			return err
		}
	}
	type dailyResult struct {
		day, at string
		correct bool
		results []mathQuestionResult
	}
	byKnowledge := map[string]map[string]*dailyResult{}
	for _, result := range results {
		if result.Day == "" {
			result.Day = entry.Day
		}
		if result.At == "" {
			result.At, _ = entry.At.(string)
		}
		if byKnowledge[result.KnowledgeID] == nil {
			byKnowledge[result.KnowledgeID] = map[string]*dailyResult{}
		}
		daily := byKnowledge[result.KnowledgeID][result.Day]
		if daily == nil {
			daily = &dailyResult{day: result.Day, at: result.At, correct: true}
			byKnowledge[result.KnowledgeID][result.Day] = daily
		}
		daily.correct = daily.correct && result.Correct != nil && *result.Correct
		if result.At > daily.at {
			daily.at = result.At
		}
		daily.results = append(daily.results, result)
	}
	for id, days := range byKnowledge {
		status := knowledge[id]
		status.ID, status.Type = id, kind
		ordered := make([]string, 0, len(days))
		for day := range days {
			ordered = append(ordered, day)
		}
		sort.Strings(ordered)
		for _, day := range ordered {
			daily := days[day]
			for _, result := range daily.results {
				status.Attempts++
				if result.Correct == nil || !*result.Correct {
					status.Mistakes++
				}
			}
			if daily.at >= status.LastSeenAt {
				status.LastSeenAt, status.LastCorrect = daily.at, daily.correct
			}
			// Only the first recorded attempt on a due calendar day advances its own
			// knowledge point; another point's schedule never controls this decision.
			if status.ReviewDay >= day || status.NextReview > day {
				continue
			}
			stage := max(0, min(status.Stage, len(reviewIntervals)-1))
			interval, nextStage, last := 1, 0, "forgot"
			if daily.correct {
				interval, nextStage, last = reviewIntervals[stage], min(stage+1, len(reviewIntervals)-1), "remember"
			}
			date, err := time.Parse("2006-01-02", day)
			if err != nil {
				return err
			}
			status.ReviewDay, status.ReviewStartStage, status.Stage, status.LastResult = day, stage, nextStage, last
			status.NextReview = date.AddDate(0, 0, interval).Format("2006-01-02")
		}
		knowledge[id] = status
	}
	item["mathKnowledge"], _ = json.Marshal(knowledge)
	return nil
}

func mathAnswerForKey(kind, key string) int {
	if kind == "math" {
		match := arithmeticKey.FindStringSubmatch(key)
		if match == nil {
			return -1
		}
		a, _ := strconv.Atoi(match[1])
		b, _ := strconv.Atoi(match[3])
		if match[2] == "+" {
			return a + b
		}
		return a - b
	}
	match := bondKey.FindStringSubmatch(key)
	if match == nil {
		return -1
	}
	field := 1
	if match[5] == "010" {
		field = 2
	} else if match[5] == "001" {
		field = 3
	}
	answer, _ := strconv.Atoi(match[field])
	return answer
}
