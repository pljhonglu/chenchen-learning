package main

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func mathGroup(id string, results []map[string]any) studyGroupRequest {
	keys := make([]string, len(results))
	correct := 0
	for index, result := range results {
		keys[index] = result["key"].(string)
		if result["correct"] == true {
			correct++
		}
	}
	result := "supported"
	if correct == len(results) {
		result = "independent"
	} else if correct == 0 {
		result = "again"
	}
	return studyGroupRequest{ID: id, Type: "math", Mode: "learn", Entries: []studyEntry{{SchemaVersion: 2, ID: "math-addsub-10", Type: "math", Title: "加减法", Skill: "math-solving", Source: "automatic", Result: result, Details: map[string]any{"total": len(results), "correct": correct, "questionKeys": keys, "questionResults": results}}}}
}

func mathStatus(t *testing.T, stored progress, id string) mathKnowledge {
	t.Helper()
	item := decodeState(t, progressItems(t, stored)["math-addsub-10"])
	knowledge := decodeState(t, item["mathKnowledge"])
	var result mathKnowledge
	if err := json.Unmarshal(knowledge[id], &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMathKnowledgeSchedulesAndMistakesAreIndependent(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	day := "2026-10-03"
	app.store.now = func() time.Time { return gardenTestTime(day) }
	group := mathGroup("first", []map[string]any{{"key": "1+2", "knowledgeId": "add-total-3", "correct": true}, {"key": "5-2", "knowledgeId": "sub-whole-5", "correct": false}})
	stored, err := app.store.completeStudyGroup(ctx, group)
	if err != nil {
		t.Fatal(err)
	}
	addition, subtraction := mathStatus(t, stored, "add-total-3"), mathStatus(t, stored, "sub-whole-5")
	if addition.Stage != 1 || addition.NextReview != "2026-10-04" || addition.Mistakes != 0 || subtraction.Stage != 0 || subtraction.Mistakes != 1 || subtraction.LastResult != "forgot" {
		t.Fatalf("knowledge not independent: %+v %+v", addition, subtraction)
	}
	retry, err := app.store.completeStudyGroup(ctx, group)
	if err != nil || !reflect.DeepEqual(stored, retry) {
		t.Fatal("retry duplicated knowledge attempts")
	}
	repeated := mathGroup("same-day", []map[string]any{{"key": "2+1", "knowledgeId": "add-total-3", "correct": true}})
	stored, err = app.store.completeStudyGroup(ctx, repeated)
	if err != nil {
		t.Fatal(err)
	}
	addition = mathStatus(t, stored, "add-total-3")
	if addition.Stage != 1 || addition.Attempts != 2 || addition.NextReview != "2026-10-04" {
		t.Fatal("same day advanced knowledge")
	}
	day = "2026-10-04"
	next := mathGroup("next-day", []map[string]any{{"key": "3+0", "knowledgeId": "add-total-3", "correct": true}})
	stored, err = app.store.completeStudyGroup(ctx, next)
	if err != nil {
		t.Fatal(err)
	}
	addition, subtraction = mathStatus(t, stored, "add-total-3"), mathStatus(t, stored, "sub-whole-5")
	if addition.Stage != 2 || addition.NextReview != "2026-10-06" || subtraction.Stage != 0 || subtraction.Attempts != 1 {
		t.Fatal("another knowledge point changed")
	}
	if readGarden(t, stored).Groups["next-day"].Count != 1 {
		t.Fatal("short math round count is wrong")
	}
	day = "2026-10-05"
	early := mathGroup("early", []map[string]any{{"key": "0+3", "knowledgeId": "add-total-3", "correct": false}})
	stored, err = app.store.completeStudyGroup(ctx, early)
	if err != nil {
		t.Fatal(err)
	}
	addition = mathStatus(t, stored, "add-total-3")
	if addition.Stage != 2 || addition.NextReview != "2026-10-06" || addition.Mistakes != 1 {
		t.Fatal("early practice changed due date or lost mistake")
	}
}

func TestMathDraftLocksQuestionsAndUsesPerQuestionFirstDates(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	day := "2026-10-03"
	app.store.now = func() time.Time { return gardenTestTime(day) }
	results := []map[string]any{{"key": "1+2", "knowledgeId": "add-total-3", "correct": true}, {"key": "5-2", "knowledgeId": "sub-whole-5", "correct": false}}
	group := mathGroup("math-draft", results)
	draft := sessionFor(group)
	questions := []any{map[string]any{"key": "1+2", "knowledgeId": "add-total-3"}, map[string]any{"key": "5-2", "knowledgeId": "sub-whole-5"}}
	draft.Progress = map[string]any{"practice": map[string]any{"questions": questions, "questionResults": []any{map[string]any{"key": "1+2", "knowledgeId": "add-total-3", "correct": true, "answer": 3}}, "index": 0}}
	first, err := app.store.saveStudySession(ctx, draft)
	if err != nil {
		t.Fatal(err)
	}
	day = "2026-10-04"
	repeat, err := app.store.saveStudySession(ctx, draft)
	if err != nil || !reflect.DeepEqual(first, repeat) {
		t.Fatalf("math retry changed first timestamp: %v", err)
	}
	raw, _ := json.Marshal(draft)
	var tampered studySessionRequest
	_ = json.Unmarshal(raw, &tampered)
	practice := sessionPractice(tampered.Progress)
	answers := practice["questionResults"].([]any)
	answers[0].(map[string]any)["correct"] = false
	_, err = app.store.saveStudySession(ctx, tampered)
	gardenErrorCode(t, err, "study_session_conflict")
	_ = json.Unmarshal(raw, &tampered)
	sessionPractice(tampered.Progress)["questions"].([]any)[0].(map[string]any)["key"] = "0+3"
	_, err = app.store.saveStudySession(ctx, tampered)
	gardenErrorCode(t, err, "study_session_conflict")
	draft.Progress["practice"].(map[string]any)["questionResults"] = []any{
		map[string]any{"key": "1+2", "knowledgeId": "add-total-3", "correct": true, "answer": 3},
		map[string]any{"key": "5-2", "knowledgeId": "sub-whole-5", "correct": false, "answer": 4},
	}
	if _, err = app.store.saveStudySession(ctx, draft); err != nil {
		t.Fatal(err)
	}
	day = "2026-10-05"
	stored, err := app.store.completeStudyGroup(ctx, group)
	if err != nil {
		t.Fatal(err)
	}
	addition, subtraction := mathStatus(t, stored, "add-total-3"), mathStatus(t, stored, "sub-whole-5")
	if addition.ReviewDay != "2026-10-03" || addition.NextReview != "2026-10-04" || subtraction.ReviewDay != "2026-10-04" || subtraction.NextReview != "2026-10-05" {
		t.Fatalf("math answer dates overwritten: %+v %+v", addition, subtraction)
	}
	if readGarden(t, stored).Groups[group.ID].Day != "2026-10-05" {
		t.Fatal("reward not counted on completion day")
	}
}

func TestMathResultValidationRejectsMismatchedAndImpossibleKnowledge(t *testing.T) {
	original := mathGroup("invalid", []map[string]any{{"key": "1+2", "knowledgeId": "add-total-3", "correct": true}})
	raw, _ := json.Marshal(original)
	mutations := []func(*studyGroupRequest){
		func(g *studyGroupRequest) {
			g.Entries[0].Details["questionResults"].([]any)[0].(map[string]any)["knowledgeId"] = "sub-whole-3"
		},
		func(g *studyGroupRequest) {
			g.Entries[0].Details["questionResults"].([]any)[0].(map[string]any)["correct"] = false
		},
		func(g *studyGroupRequest) { g.Entries[0].Details["questionKeys"] = []string{"2+2"} },
		func(g *studyGroupRequest) { g.Entries[0].Details["total"] = 0 },
		func(g *studyGroupRequest) { g.Entries[0].Details["total"] = 11 },
	}
	for _, change := range mutations {
		app := testApp(t)
		var group studyGroupRequest
		_ = json.Unmarshal(raw, &group)
		change(&group)
		_, err := app.store.completeStudyGroup(context.Background(), group)
		gardenErrorCode(t, err, "invalid_study_group")
		stored, _ := app.store.get(context.Background())
		if stored.Found {
			t.Fatal("invalid math group changed state")
		}
	}
	for _, sample := range []struct {
		kind, key, id string
		valid         bool
	}{
		{"math", "1+2", "add-total-3", true}, {"math", "5-2", "sub-whole-5", true}, {"math", "8+8", "add-total-16", false}, {"math", "2-5", "sub-whole-2", false},
		{"decomp", "5:2:3:decomp:010", "bond-part-5", true}, {"decomp", "5:2:3:compose:100", "bond-whole-5", true},
		{"decomp", "5:2:4:decomp:010", "bond-part-5", false}, {"decomp", "5:2:3:compose:010", "bond-whole-5", false},
	} {
		if validMathKnowledge(sample.kind, sample.key, sample.id) != sample.valid {
			t.Fatalf("invalid knowledge decision %+v", sample)
		}
	}
}

func TestMathCompletedRoundCannotReplacePersistedAnswerOrPlan(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	group := mathGroup("plan", []map[string]any{{"key": "1+2", "knowledgeId": "add-total-3", "correct": true}})
	draft := sessionFor(group)
	draft.Progress = map[string]any{"practice": map[string]any{"questions": []any{map[string]any{"key": "1+2", "knowledgeId": "add-total-3"}}, "questionResults": []any{map[string]any{"key": "1+2", "knowledgeId": "add-total-3", "correct": false, "answer": 4}}}}
	if _, err := app.store.saveStudySession(ctx, draft); err != nil {
		t.Fatal(err)
	}
	_, err := app.store.completeStudyGroup(ctx, group)
	gardenErrorCode(t, err, "study_session_conflict")
	forged := mathGroup("plan", []map[string]any{{"key": "0+3", "knowledgeId": "add-total-3", "correct": true}})
	_, err = app.store.completeStudyGroup(ctx, forged)
	gardenErrorCode(t, err, "study_session_conflict")
}
