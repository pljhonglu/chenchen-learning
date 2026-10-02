package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func confirmationOperations(key, result, day, at, skill, details string) []progressOperation {
	return []progressOperation{
		operation("merge", "items", "lesson", `{"stage":5,"nextReview":"2099-01-01","reviewDay":"2026-10-02","reviewStartStage":4,"lastResult":"remember","note":"metadata kept"}`),
		operation("set", "activity", key, fmt.Sprintf(`{"schemaVersion":2,"id":"lesson","type":"write","skill":%q,"source":"parent","result":%q,"day":%q,"at":%q,"details":%s}`, skill, result, day, at, details)),
	}
}

func storeLesson(t *testing.T, store *progressStore, value string) {
	t.Helper()
	if _, err := store.patch(context.Background(), []progressOperation{operation("set", "items", "lesson", value)}); err != nil {
		t.Fatal(err)
	}
}

func storedLesson(t *testing.T, store *progressStore) map[string]json.RawMessage {
	t.Helper()
	progress, err := store.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return decodeState(t, decodeState(t, decodeState(t, progress.Payload)["items"])["lesson"])
}

func assertSchedule(t *testing.T, lesson map[string]json.RawMessage, stage int, nextReview, result string) {
	t.Helper()
	if string(lesson["stage"]) != fmt.Sprint(stage) || jsonString(lesson["nextReview"]) != nextReview || jsonString(lesson["lastResult"]) != result {
		t.Fatalf("unexpected schedule: %s", mustJSON(lesson))
	}
}

func mustJSON(value any) string { raw, _ := json.Marshal(value); return string(raw) }

func TestAssessmentFirstSameDayCheckProtectsScheduleAcrossDevices(t *testing.T) {
	dir := t.TempDir()
	first, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer first.db.Close()
	second, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer second.db.Close()
	storeLesson(t, first, `{"type":"write","learned":true,"stage":4,"nextReview":"2026-10-02"}`)
	early := confirmationOperations("early", "again", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", "{}")
	late := confirmationOperations("late", "independent", "2026-10-02", "2026-10-02T09:00:00Z", "hanzi-writing", "{}")
	// Deliver in reverse time order: a late network arrival must still choose
	// the actual first check and the day's original stage.
	if _, err := second.patch(context.Background(), late); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, first), 5, "2026-10-17", "remember")
	if _, err := first.patch(context.Background(), early); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, first), 0, "2026-10-03", "forgot")
	var writers sync.WaitGroup
	for index := 0; index < 12; index++ {
		writers.Add(1)
		go func() {
			defer writers.Done()
			if _, err := second.patch(context.Background(), late); err != nil {
				t.Error(err)
			}
		}()
	}
	writers.Wait()
	assertSchedule(t, storedLesson(t, first), 0, "2026-10-03", "forgot")
	progress, _ := first.get(context.Background())
	if len(decodeState(t, decodeState(t, progress.Payload)["activity"])) != 2 {
		t.Fatal("retry duplicated activity")
	}
}

func TestAssessmentFailedThenPassedAndNewDayRetryDoNotAdvanceAgain(t *testing.T) {
	app := testApp(t)
	storeLesson(t, app.store, `{"type":"write","stage":4,"nextReview":"2026-10-02"}`)
	early := confirmationOperations("first", "again", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", "{}")
	for _, ops := range [][]progressOperation{early, confirmationOperations("second", "independent", "2026-10-02", "2026-10-02T09:00:00Z", "hanzi-writing", "{}")} {
		if _, err := app.store.patch(context.Background(), ops); err != nil {
			t.Fatal(err)
		}
	}
	assertSchedule(t, storedLesson(t, app.store), 0, "2026-10-03", "forgot")
	if _, err := app.store.patch(context.Background(), confirmationOperations("tomorrow", "independent", "2026-10-03", "2026-10-03T08:00:00Z", "hanzi-writing", "{}")); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, app.store), 1, "2026-10-04", "remember")
	if _, err := app.store.patch(context.Background(), early); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, app.store), 1, "2026-10-04", "remember")
}

func TestAssessmentEarlyPracticeAndDifferentSkillPreserveExistingSchedule(t *testing.T) {
	t.Run("legacy same day", func(t *testing.T) {
		app := testApp(t)
		storeLesson(t, app.store, `{"type":"write","stage":4,"reviewDay":"2026-10-02","reviewStartStage":3,"nextReview":"2026-10-09","lastResult":"remember"}`)
		if _, err := app.store.patch(context.Background(), confirmationOperations("new-format", "again", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", "{}")); err != nil {
			t.Fatal(err)
		}
		assertSchedule(t, storedLesson(t, app.store), 4, "2026-10-09", "remember")
	})
	t.Run("not due", func(t *testing.T) {
		app := testApp(t)
		storeLesson(t, app.store, `{"type":"write","stage":4,"nextReview":"2026-10-10","lastResult":"remember"}`)
		if _, err := app.store.patch(context.Background(), confirmationOperations("early", "again", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", "{}")); err != nil {
			t.Fatal(err)
		}
		assertSchedule(t, storedLesson(t, app.store), 4, "2026-10-10", "remember")
	})
	t.Run("different skill", func(t *testing.T) {
		app := testApp(t)
		storeLesson(t, app.store, `{"type":"write","stage":4,"nextReview":"2026-10-02"}`)
		if _, err := app.store.patch(context.Background(), confirmationOperations("writing", "again", "2026-10-02", "2026-10-02T09:00:00Z", "hanzi-writing", "{}")); err != nil {
			t.Fatal(err)
		}
		if _, err := app.store.patch(context.Background(), confirmationOperations("recognition", "independent", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-recognition", "{}")); err != nil {
			t.Fatal(err)
		}
		assertSchedule(t, storedLesson(t, app.store), 0, "2026-10-03", "forgot")
	})
}

func TestAssessmentRehearsedSuccessKeepsShortInterval(t *testing.T) {
	for _, flag := range []string{"afterPractice", "observedExposure", "exposureFirst"} {
		t.Run(flag, func(t *testing.T) {
			app := testApp(t)
			storeLesson(t, app.store, `{"type":"write","stage":4,"nextReview":"2026-10-02"}`)
			if _, err := app.store.patch(context.Background(), confirmationOperations("check", "independent", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", fmt.Sprintf(`{%q:true}`, flag))); err != nil {
				t.Fatal(err)
			}
			assertSchedule(t, storedLesson(t, app.store), 0, "2026-10-03", "fuzzy")
		})
	}
}

func TestAssessmentCreateAndRetryPreserveExistingReviewBase(t *testing.T) {
	app := testApp(t)
	ops := confirmationOperations("check", "independent", "2026-10-02", "2026-10-02T08:00:00Z", "hanzi-writing", "{}")
	ops = append([]progressOperation{operation("create", "items", "lesson", `{"type":"write","learned":true,"stage":4,"nextReview":"2026-10-02"}`)}, ops...)
	if _, err := app.store.patch(context.Background(), ops); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, app.store), 1, "2026-10-03", "remember")
	if _, err := app.store.patch(context.Background(), ops); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, app.store), 1, "2026-10-03", "remember")
	if _, err := app.store.patch(context.Background(), []progressOperation{operation("delete", "items", "lesson", "")}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.store.patch(context.Background(), ops); err != nil {
		t.Fatal(err)
	}
	assertSchedule(t, storedLesson(t, app.store), 1, "2026-10-03", "remember")
}

func TestDeleteKeepsModernTitleSnapshotAndLegacyFields(t *testing.T) {
	app := testApp(t)
	storeLesson(t, app.store, `{"type":"write","title":"新的标题"}`)
	if _, err := app.store.patch(context.Background(), []progressOperation{
		operation("set", "activity", "modern", `{"schemaVersion":2,"id":"lesson","title":"原来的标题","result":"independent"}`),
		operation("set", "activity", "legacy", `{"id":"lesson","day":"2026-10-02","listening":"independent"}`),
		operation("delete", "items", "lesson", "")}); err != nil {
		t.Fatal(err)
	}
	progress, _ := app.store.get(context.Background())
	activity := decodeState(t, decodeState(t, progress.Payload)["activity"])
	modern, legacy := decodeState(t, activity["modern"]), decodeState(t, activity["legacy"])
	if jsonString(modern["title"]) != "原来的标题" || jsonString(legacy["title"]) != "新的标题" || legacy["schemaVersion"] != nil || legacy["result"] != nil {
		t.Fatalf("bad snapshots: %s", activity)
	}
}

func TestProgressCapacityAcceptsHistoryBeyondOldLimitAndRejectsOversizedPut(t *testing.T) {
	app := testApp(t)
	payload := `{"items":{},"historyPadding":"` + strings.Repeat("x", 600_000) + `"}`
	res := request(app, http.MethodPut, "/api/progress", `{"payload":`+payload+`}`)
	if res.Code != http.StatusOK {
		t.Fatalf("history above old limit: %d", res.Code)
	}
	tooLarge := `{"payload":{"items":{},"historyPadding":"` + strings.Repeat("x", maxProgressBytes) + `"}}`
	res = request(app, http.MethodPut, "/api/progress", tooLarge)
	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected bounded PUT: %d", res.Code)
	}
	stored, _ := app.store.get(context.Background())
	if string(stored.Payload) != payload {
		t.Fatal("oversized PUT changed history")
	}
}
