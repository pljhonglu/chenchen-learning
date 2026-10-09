package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"reflect"
	"testing"
	"time"
)

func automaticWritingGroup(id string) studyGroupRequest {
	return studyGroupRequest{ID: id, Type: "write", Mode: "learn", Entries: []studyEntry{{
		SchemaVersion: 2, ID: "write-char-6728", Type: "write", Title: "汉字·木", Skill: "hanzi-writing", Source: "automatic", Result: "independent",
		Details: map[string]any{"method": "stroke-quiz", "engine": "hanzi-writer-3.7.3", "character": "木", "totalStrokes": 4, "completedStrokes": 4, "totalMistakes": 0, "hintsUsed": 0, "outlineShown": false, "afterPractice": false, "assisted": false},
	}}}
}

func TestAutomaticWritingCompletesThroughHTTPWithoutParentConfirmation(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	group := automaticWritingGroup("automatic-writing")
	draft := sessionFor(group)
	draft.Entries = group.Entries
	for _, submission := range []struct {
		path string
		body any
	}{{"/api/study-sessions", draft}, {"/api/study-groups", group}} {
		body, _ := json.Marshal(submission.body)
		response := request(app, http.MethodPost, submission.path, string(body))
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", submission.path, response.Code, response.Body.String())
		}
	}
	stored, err := app.store.get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, stored.Payload)
	item := decodeState(t, decodeState(t, state["items"])[group.Entries[0].ID])
	assertSchedule(t, item, 1, "2026-10-04", "remember")
	var event studyEntry
	if err := json.Unmarshal(decodeState(t, state["activity"])["study-group:automatic-writing:0"], &event); err != nil {
		t.Fatal(err)
	}
	if event.Source != "automatic" || event.Result != "independent" || event.Details["completedStrokes"] != float64(4) || len(decodeState(t, state["studySessions"])) != 0 || readGarden(t, stored).Groups[group.ID].WaterAwarded != 1 {
		t.Fatalf("automatic completion not recorded: %s", stored.Payload)
	}
}

func TestAutomaticWritingRejectsIncompleteOrInconsistentResults(t *testing.T) {
	mutations := map[string]func(*studyEntry){
		"no details":      func(e *studyEntry) { e.Details = nil },
		"wrong method":    func(e *studyEntry) { e.Details["method"] = "paper" },
		"wrong engine":    func(e *studyEntry) { e.Details["engine"] = "other" },
		"wrong character": func(e *studyEntry) { e.Details["character"] = "水" },
		"non hanzi":       func(e *studyEntry) { e.Details["character"] = "a" },
		"two characters":  func(e *studyEntry) { e.Details["character"] = "木木" },
		"unfinished":      func(e *studyEntry) { e.Details["completedStrokes"] = 3 },
		"extra strokes":   func(e *studyEntry) { e.Details["completedStrokes"] = 5 },
		"zero strokes":    func(e *studyEntry) { e.Details["totalStrokes"], e.Details["completedStrokes"] = 0, 0 },
		"too many strokes": func(e *studyEntry) {
			e.Details["totalStrokes"], e.Details["completedStrokes"] = 21, 21
		},
		"mistakes claimed independent": func(e *studyEntry) { e.Details["totalMistakes"] = 1 },
		"hint claimed independent":     func(e *studyEntry) { e.Details["hintsUsed"] = 1 },
		"outline claimed independent":  func(e *studyEntry) { e.Details["outlineShown"] = true },
		"practice claimed independent": func(e *studyEntry) { e.Details["afterPractice"] = true },
		"assisted claimed independent": func(e *studyEntry) { e.Details["assisted"] = true },
		"unsupported result":           func(e *studyEntry) { e.Result = "supported" },
		"incomplete result":            func(e *studyEntry) { e.Result = "again" },
	}
	for _, field := range []string{"totalStrokes", "completedStrokes", "totalMistakes", "hintsUsed", "outlineShown", "afterPractice", "assisted"} {
		mutations["missing "+field] = func(e *studyEntry) { delete(e.Details, field) }
		mutations["string "+field] = func(e *studyEntry) { e.Details[field] = "0" }
	}
	for _, field := range []string{"totalStrokes", "completedStrokes", "totalMistakes", "hintsUsed"} {
		for name, value := range map[string]any{"negative": -1, "fraction": 0.5, "nan": math.NaN(), "infinite": math.Inf(1)} {
			mutations[name+" "+field] = func(e *studyEntry) { e.Details[field] = value }
		}
	}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			group := automaticWritingGroup("invalid")
			change(&group.Entries[0])
			_, _, err := validateStudyGroup(group)
			gardenErrorCode(t, err, "invalid_study_group")
			draft := sessionFor(group)
			draft.Entries = group.Entries
			gardenErrorCode(t, validateSession(&draft), "invalid_study_group")
		})
	}
	// Reject the whole request without saving a partial draft, history, or reward.
	app := testApp(t)
	group := automaticWritingGroup("incomplete-http")
	group.Entries[0].Details["completedStrokes"] = 3
	draft := sessionFor(group)
	draft.Entries = group.Entries
	for path, body := range map[string]any{"/api/study-sessions": draft, "/api/study-groups": group} {
		raw, _ := json.Marshal(body)
		if response := request(app, http.MethodPost, path, string(raw)); response.Code != http.StatusBadRequest {
			t.Fatalf("incomplete writing accepted: %d %s", response.Code, response.Body.String())
		}
	}
	if stored, _ := app.store.get(context.Background()); stored.Found {
		t.Fatal("invalid automatic writing changed stored progress")
	}
}

func TestAutomaticWritingSupportChangesReviewSchedule(t *testing.T) {
	for _, field := range []string{"independent", "totalMistakes", "hintsUsed", "outlineShown", "afterPractice", "assisted"} {
		t.Run(field, func(t *testing.T) {
			app := testApp(t)
			ctx := context.Background()
			app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
			group := automaticWritingGroup("review")
			group.Mode = "review"
			entry := &group.Entries[0]
			if _, err := app.store.patch(ctx, []progressOperation{operation("set", "items", entry.ID, `{"type":"write","learned":true,"stage":3,"nextReview":"2026-10-03"}`)}); err != nil {
				t.Fatal(err)
			}
			if field != "independent" {
				entry.Result = "supported"
				entry.Details[field] = true
				if field == "totalMistakes" || field == "hintsUsed" {
					entry.Details[field] = 1
				}
			}
			stored, err := app.store.completeStudyGroup(ctx, group)
			if err != nil {
				t.Fatal(err)
			}
			item := decodeState(t, progressItems(t, stored)[entry.ID])
			if field == "independent" {
				assertSchedule(t, item, 4, "2026-10-10", "remember")
			} else {
				assertSchedule(t, item, 0, "2026-10-04", "fuzzy")
			}
		})
	}
}

func TestAutomaticWritingPreservesLegacyDraftsAndCustomCharacters(t *testing.T) {
	app := testApp(t)
	group := automaticWritingGroup("mixed-writing")
	group.Entries[0].ID = "write-custom"
	legacy := gardenTestGroup("unused", "write", "legacy").Entries[0]
	legacy.Result, legacy.Details = "supported", map[string]any{"method": "paper", "afterPractice": true}
	group.Entries = append([]studyEntry{legacy}, group.Entries...)
	draft := sessionFor(group)
	draft.Entries = group.Entries[:1]
	ctx := context.Background()
	if _, err := app.store.saveStudySession(ctx, draft); err != nil {
		t.Fatal(err)
	}
	stored, err := app.store.completeStudyGroup(ctx, group)
	if err != nil {
		t.Fatal(err)
	}
	activity := decodeState(t, decodeState(t, stored.Payload)["activity"])
	if len(activity) != 2 || jsonString(decodeState(t, activity["study-group:mixed-writing:0"])["source"]) != "parent" || jsonString(decodeState(t, activity["study-group:mixed-writing:1"])["source"]) != "automatic" {
		t.Fatal("legacy and custom writing results were not both retained")
	}
}

func TestAutomaticWritingCannotDiscardSavedPracticeFlag(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	group := automaticWritingGroup("already-practiced")
	draft := sessionFor(group)
	draft.Items[0].AfterPractice = true
	original, err := app.store.saveStudySession(ctx, draft)
	if err != nil {
		t.Fatal(err)
	}
	draft.Entries = group.Entries
	_, err = app.store.saveStudySession(ctx, draft)
	gardenErrorCode(t, err, "study_session_conflict")
	_, err = app.store.completeStudyGroup(ctx, group)
	gardenErrorCode(t, err, "study_session_conflict")
	if after, _ := app.store.get(ctx); !reflect.DeepEqual(original, after) {
		t.Fatal("rejected practice flag rewrite changed stored session")
	}
	group.Entries[0].Details["afterPractice"] = true
	group.Entries[0].Result = "supported"
	if _, err := app.store.completeStudyGroup(ctx, group); err != nil {
		t.Fatal(err)
	}
}

func TestAutomaticWritingEarlyPracticeKeepsScheduleAndSupportedResult(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	group := automaticWritingGroup("early-writing")
	id := group.Entries[0].ID
	if _, err := app.store.patch(ctx, []progressOperation{operation("set", "items", id, `{"type":"write","learned":true,"stage":3,"nextReview":"2026-10-10","lastResult":"remember"}`)}); err != nil {
		t.Fatal(err)
	}
	stored, err := app.store.completeStudyGroup(ctx, group)
	if err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, decodeState(t, progressItems(t, stored)[id]), 3, "2026-10-10", "remember")
	var event studyEntry
	_ = json.Unmarshal(decodeState(t, decodeState(t, stored.Payload)["activity"])["study-group:early-writing:0"], &event)
	if event.Result != "supported" || event.Details["afterPractice"] != true {
		t.Fatal("early practice was stored as an independent assessment")
	}
}
