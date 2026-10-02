package main

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

var reviewFields = []string{"stage", "nextReview", "reviewDay", "reviewStartStage", "lastResult"}
var reviewIntervals = []int{1, 2, 4, 7, 15, 30}

type assessmentEvent struct {
	SchemaVersion int             `json:"schemaVersion"`
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Skill         string          `json:"skill"`
	Day           string          `json:"day"`
	At            json.RawMessage `json:"at"`
	Result        string          `json:"result"`
	Source        string          `json:"source"`
	Details       struct {
		AfterPractice    bool `json:"afterPractice"`
		ObservedExposure bool `json:"observedExposure"`
		ExposureFirst    bool `json:"exposureFirst"`
	} `json:"details"`
	key  string
	time time.Time
}

func copyEntries(entries map[string]json.RawMessage) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(entries))
	for key, value := range entries {
		result[key] = value
	}
	return result
}

func jsonString(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}

func snapshotActivityTitles(activity map[string]json.RawMessage, id string, item json.RawMessage) {
	var lesson map[string]json.RawMessage
	if json.Unmarshal(item, &lesson) != nil || strings.TrimSpace(jsonString(lesson["title"])) == "" {
		return
	}
	for key, raw := range activity {
		var event map[string]json.RawMessage
		if json.Unmarshal(raw, &event) != nil || jsonString(event["id"]) != id || strings.TrimSpace(jsonString(event["title"])) != "" {
			continue
		}
		event["title"] = lesson["title"]
		activity[key], _ = json.Marshal(event)
	}
}

func parseAssessment(key string, raw json.RawMessage) (assessmentEvent, bool) {
	var event assessmentEvent
	if json.Unmarshal(raw, &event) != nil || event.SchemaVersion != 2 || event.ID == "" || event.Skill == "" ||
		(event.Source != "parent" && event.Source != "automatic") ||
		(event.Result != "independent" && event.Result != "supported" && event.Result != "again") {
		return event, false
	}
	day, err := time.Parse("2006-01-02", event.Day)
	if err != nil {
		return event, false
	}
	event.key, event.time = key, day
	if at, err := time.Parse(time.RFC3339Nano, jsonString(event.At)); err == nil {
		event.time = at
	} else {
		var milliseconds int64
		if len(event.At) > 0 && string(event.At) != "null" && json.Unmarshal(event.At, &milliseconds) == nil {
			event.time = time.UnixMilli(milliseconds)
		}
	}
	return event, true
}

func earlierAssessment(a, b assessmentEvent) bool {
	if !a.time.Equal(b.time) {
		return a.time.Before(b.time)
	}
	return a.key < b.key
}

// Only schema-2 confirmation batches use this guard. Legacy PATCH/PUT formats
// retain their existing behavior. The enclosing SQLite write transaction makes
// the decision against the current history, not a stale device snapshot.
func reconcileAssessmentSchedules(previousItems, previousActivity, items, activity map[string]json.RawMessage, operations []progressOperation) error {
	changedItems := make(map[string]bool)
	candidates := make(map[string]assessmentEvent)
	for _, operation := range operations {
		if operation.Collection == "items" && (operation.Op == "merge" || operation.Op == "create") {
			changedItems[operation.Key] = true
		}
		if operation.Collection != "activity" || (operation.Op != "set" && operation.Op != "create") {
			continue
		}
		event, valid := parseAssessment(operation.Key, activity[operation.Key])
		if !valid {
			continue
		}
		current, exists := candidates[event.ID]
		if !exists || event.Day > current.Day || event.Day == current.Day && earlierAssessment(event, current) {
			candidates[event.ID] = event
		}
	}
	keys := make([]string, 0, len(activity))
	for key := range activity {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for id, candidate := range candidates {
		if !changedItems[id] || items[id] == nil {
			continue
		}
		var current, previous map[string]json.RawMessage
		if err := json.Unmarshal(items[id], &current); err != nil {
			return err
		}
		if previousItems[id] != nil {
			if err := json.Unmarshal(previousItems[id], &previous); err != nil {
				return err
			}
		}
		// Strip all client-provided schedule changes before deciding whether this
		// confirmation is eligible. Metadata and the full activity remain intact.
		for _, field := range reviewFields {
			if raw, exists := previous[field]; exists {
				current[field] = raw
			} else {
				delete(current, field)
			}
		}
		first := candidate
		otherSkillAlreadyChecked := false
		sameSkillAlreadyChecked := false
		for _, key := range keys {
			event, valid := parseAssessment(key, activity[key])
			if !valid || event.ID != id || event.Day != candidate.Day {
				continue
			}
			if event.Type != candidate.Type || event.Skill != candidate.Skill {
				if _, existed := previousActivity[key]; existed {
					otherSkillAlreadyChecked = true
				}
				continue
			}
			if _, existed := previousActivity[key]; existed {
				sameSkillAlreadyChecked = true
			}
			if earlierAssessment(event, first) {
				first = event
			}
		}
		_, firstAlreadyStored := previousActivity[first.key]
		previousDay, nextReview := jsonString(previous["reviewDay"]), jsonString(previous["nextReview"])
		previousType := jsonString(previous["type"])
		eligible := (!firstAlreadyStored || previous == nil) && (!otherSkillAlreadyChecked || previous == nil) && (previousType == "" || previousType == candidate.Type) &&
			previousDay <= candidate.Day && (previousDay != candidate.Day || sameSkillAlreadyChecked) &&
			(previous == nil || nextReview == "" || nextReview <= candidate.Day || previousDay == candidate.Day)
		if eligible {
			stage := 0
			field := "stage"
			if previousDay == candidate.Day {
				field = "reviewStartStage"
			}
			_ = json.Unmarshal(previous[field], &stage)
			stage = max(0, min(stage, len(reviewIntervals)-1))
			independent := first.Result == "independent" && !first.Details.AfterPractice && !first.Details.ObservedExposure && !first.Details.ExposureFirst
			days, nextStage, result := 1, 0, "fuzzy"
			if first.Result == "again" {
				result = "forgot"
			}
			if independent {
				days, nextStage, result = reviewIntervals[stage], min(stage+1, len(reviewIntervals)-1), "remember"
			}
			day, _ := time.Parse("2006-01-02", candidate.Day)
			for key, value := range map[string]any{"stage": nextStage, "reviewStartStage": stage, "reviewDay": candidate.Day, "nextReview": day.AddDate(0, 0, days).Format("2006-01-02"), "lastResult": result} {
				current[key], _ = json.Marshal(value)
			}
		}
		var err error
		items[id], err = json.Marshal(current)
		if err != nil {
			return err
		}
	}
	return nil
}
