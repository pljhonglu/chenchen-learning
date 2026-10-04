package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

func gardenTestTime(day string) time.Time {
	value, _ := time.Parse(time.RFC3339, day+"T12:00:00+08:00")
	return value
}

func gardenTestGroup(id, kind, prefix string) studyGroupRequest {
	sizes := map[string]int{"poem": 5, "pinyin": 10, "write": 5, "english": 5, "math": 1, "decomp": 1}
	skills := map[string]string{"poem": "poem-recitation", "pinyin": "pinyin-reading", "write": "hanzi-writing", "english": "english-listening", "math": "math-solving", "decomp": "math-solving"}
	group := studyGroupRequest{ID: id, Type: kind, Mode: "learn"}
	for index := 0; index < sizes[kind]; index++ {
		source := "parent"
		if kind == "math" || kind == "decomp" || kind == "english" {
			source = "automatic"
		}
		group.Entries = append(group.Entries, studyEntry{SchemaVersion: 2, ID: fmt.Sprintf("%s-%d", prefix, index), Type: kind, Title: "学习内容", Skill: skills[kind], Result: "independent", Source: source, Details: map[string]any{}})
	}
	if kind == "math" || kind == "decomp" {
		keys := make([]string, 10)
		for i := range keys {
			keys[i] = fmt.Sprintf("%s-question-%d", prefix, i)
		}
		group.Entries[0].Details = map[string]any{"total": 10, "correct": 10, "questionKeys": keys}
	}
	return group
}

func readGarden(t *testing.T, stored progress) gardenLedger {
	t.Helper()
	var ledger gardenLedger
	if err := json.Unmarshal(decodeState(t, stored.Payload)["garden"], &ledger); err != nil {
		t.Fatal(err)
	}
	return ledger
}

func gardenErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var validation *patchError
	if !errors.As(err, &validation) || validation.code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func TestStudyGroupAllSubjectsSaveWholeGroupsAndIndependentSchedules(t *testing.T) {
	for _, kind := range []string{"poem", "pinyin", "write", "english", "math", "decomp"} {
		t.Run(kind, func(t *testing.T) {
			app := testApp(t)
			app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
			group := gardenTestGroup("group", kind, kind)
			group.Entries[0].Day, group.Entries[0].At = "1999-01-01", "1999-01-01T00:00:00Z"
			if len(group.Entries) > 1 {
				group.Entries[1].Result = "again"
				group.Entries[2].Details["afterPractice"] = true
			}
			stored, err := app.store.completeStudyGroup(context.Background(), group)
			if err != nil {
				t.Fatal(err)
			}
			state := decodeState(t, stored.Payload)
			items, activity := decodeState(t, state["items"]), decodeState(t, state["activity"])
			if len(items) != len(group.Entries) || len(activity) != len(group.Entries) {
				t.Fatalf("partial group: %s", stored.Payload)
			}
			ledger := readGarden(t, stored)
			if ledger.Version != 1 || ledger.Groups["group"].WaterAwarded != 1 || ledger.Groups["group"].Day != "2026-10-03" {
				t.Fatalf("bad reward: %+v", ledger)
			}
			first := decodeState(t, items[group.Entries[0].ID])
			assertSchedule(t, first, 1, "2026-10-04", "remember")
			for _, raw := range activity {
				event := decodeState(t, raw)
				if jsonString(event["day"]) != "2026-10-03" || jsonString(event["at"]) != "2026-10-03T12:00:00+08:00" {
					t.Fatal("client time trusted")
				}
			}
			if len(group.Entries) > 1 {
				assertSchedule(t, decodeState(t, items[group.Entries[1].ID]), 0, "2026-10-04", "forgot")
				assertSchedule(t, decodeState(t, items[group.Entries[2].ID]), 0, "2026-10-04", "fuzzy")
			}
		})
	}
}

func TestStudyGroupServerCalendarLimitsAndSignatureDedup(t *testing.T) {
	app := testApp(t)
	now, _ := time.Parse(time.RFC3339, "2026-10-02T16:01:00Z")
	app.store.now = func() time.Time { return now }
	ctx := context.Background()
	first := gardenTestGroup("first", "poem", "same")
	stored, err := app.store.completeStudyGroup(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if readGarden(t, stored).Groups["first"].Day != "2026-10-03" {
		t.Fatal("must use Beijing date")
	}
	first.ID, first.Mode = "reordered", "review"
	sort.Slice(first.Entries, func(i, j int) bool { return first.Entries[i].ID > first.Entries[j].ID })
	stored, err = app.store.completeStudyGroup(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if readGarden(t, stored).Groups["reordered"].WaterAwarded != 0 {
		t.Fatal("order or mode bypassed signature")
	}
	for i := 0; i < 3; i++ {
		stored, err = app.store.completeStudyGroup(ctx, gardenTestGroup(fmt.Sprint("extra", i), "write", fmt.Sprint("new", i)))
		if err != nil {
			t.Fatal(err)
		}
	}
	ledger := readGarden(t, stored)
	total := 0
	for _, group := range ledger.Groups {
		total += group.WaterAwarded
	}
	if total != 3 || len(ledger.Groups) != 5 || ledger.Groups["extra2"].WaterAwarded != 0 {
		t.Fatal("bad daily reward limit")
	}
	if len(decodeState(t, decodeState(t, stored.Payload)["activity"])) != 25 {
		t.Fatal("over-limit group lost records")
	}
	now = now.AddDate(0, 0, 1)
	first.ID = "tomorrow"
	stored, err = app.store.completeStudyGroup(ctx, first)
	if err != nil || readGarden(t, stored).Groups["tomorrow"].WaterAwarded != 1 {
		t.Fatalf("new day: %v", err)
	}
}

func TestStudyGroupRetryDoesNotRewriteFirstAnswersOrNextDayQuota(t *testing.T) {
	app := testApp(t)
	now := gardenTestTime("2026-10-03")
	app.store.now = func() time.Time { return now }
	group := gardenTestGroup("retry", "write", "字")
	group.Entries[0].Result = "again"
	first, err := app.store.completeStudyGroup(context.Background(), group)
	if err != nil {
		t.Fatal(err)
	}
	now = now.AddDate(0, 0, 1)
	group.Entries[0].Result = "independent"
	again, err := app.store.completeStudyGroup(context.Background(), group)
	if err != nil || string(first.Payload) != string(again.Payload) || first.UpdatedAt != again.UpdatedAt {
		t.Fatalf("retry changed first result: %v", err)
	}
	_, err = app.store.waterGarden(context.Background(), "tomorrow-no-group")
	gardenErrorCode(t, err, "study_group_required")
	group.Entries[0].ID = "different"
	_, err = app.store.completeStudyGroup(context.Background(), group)
	gardenErrorCode(t, err, "group_id_conflict")
}

func TestReviewGroupEarlyFillKeepsDatesAndDeletedEntryRollsBack(t *testing.T) {
	app := testApp(t)
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	group := gardenTestGroup("review", "poem", "poem")
	group.Mode = "review"
	ops := []progressOperation{}
	for i, entry := range group.Entries {
		next := "2026-10-03"
		if i > 0 {
			next = "2026-10-20"
		}
		value, _ := json.Marshal(map[string]any{"id": entry.ID, "type": "poem", "learned": true, "stage": 3, "nextReview": next, "lastResult": "remember"})
		ops = append(ops, progressOperation{Op: "set", Collection: "items", Key: entry.ID, Value: value})
	}
	if _, err := app.store.patch(context.Background(), ops); err != nil {
		t.Fatal(err)
	}
	stored, err := app.store.completeStudyGroup(context.Background(), group)
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, stored.Payload)
	items := decodeState(t, state["items"])
	assertSchedule(t, decodeState(t, items[group.Entries[0].ID]), 4, "2026-10-10", "remember")
	assertSchedule(t, decodeState(t, items[group.Entries[1].ID]), 3, "2026-10-20", "remember")
	activity := decodeState(t, state["activity"])
	early := decodeState(t, activity["study-group:review:1"])
	if string(decodeState(t, early["details"])["afterPractice"]) != "true" {
		t.Fatal("early practice lacks evidence flag")
	}
	if _, err := app.store.patch(context.Background(), []progressOperation{operation("delete", "items", group.Entries[4].ID, "")}); err != nil {
		t.Fatal(err)
	}
	before, _ := app.store.get(context.Background())
	group.ID = "deleted"
	_, err = app.store.completeStudyGroup(context.Background(), group)
	gardenErrorCode(t, err, "entry_not_found")
	after, _ := app.store.get(context.Background())
	if !reflect.DeepEqual(before, after) {
		t.Fatal("deleted item partially committed group")
	}
}

func TestWateringGatesBalanceLimitMilestonesAndRetries(t *testing.T) {
	app := testApp(t)
	now := gardenTestTime("2026-10-01")
	app.store.now = func() time.Time { return now }
	ctx := context.Background()
	_, err := app.store.waterGarden(ctx, "locked")
	gardenErrorCode(t, err, "study_group_required")
	var stored progress
	for day := 1; day <= 8; day++ {
		now = gardenTestTime(fmt.Sprintf("2026-10-%02d", day))
		for index := 0; index < 3; index++ {
			id := fmt.Sprintf("d%d-g%d", day, index)
			if _, err := app.store.completeStudyGroup(ctx, gardenTestGroup(id, "write", id)); err != nil {
				t.Fatal(err)
			}
			stored, err = app.store.waterGarden(ctx, "water-"+id)
			if err != nil {
				t.Fatal(err)
			}
			if day == 1 && index == 0 {
				_, err = app.store.waterGarden(ctx, "empty")
				gardenErrorCode(t, err, "water_required")
			}
		}
		_, err = app.store.waterGarden(ctx, fmt.Sprint("extra", day))
		gardenErrorCode(t, err, "daily_watering_limit")
	}
	ledger := readGarden(t, stored)
	if len(ledger.Watering) != 24 || len(ledger.Gifts) != 2 || ledger.Gifts["1"].WaterTotal != 12 || ledger.Gifts["2"].WaterTotal != 24 || ledger.Gifts["1"].Day != "2026-10-04" {
		t.Fatalf("wrong milestones: %+v", ledger.Gifts)
	}
	now = now.AddDate(0, 0, 1)
	retry, err := app.store.waterGarden(ctx, "water-d8-g2")
	if err != nil || !reflect.DeepEqual(retry, stored) {
		t.Fatal("water retry modified ledger or required new group")
	}
}

func TestSavedWaterSurvivesRestDaysButNeedsTodaysGroup(t *testing.T) {
	app := testApp(t)
	now := gardenTestTime("2026-10-03")
	app.store.now = func() time.Time { return now }
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := app.store.completeStudyGroup(ctx, gardenTestGroup(fmt.Sprint(i), "poem", fmt.Sprint(i))); err != nil {
			t.Fatal(err)
		}
	}
	now = now.AddDate(0, 0, 5)
	_, err := app.store.waterGarden(ctx, "rest")
	gardenErrorCode(t, err, "study_group_required")
	if _, err := app.store.completeStudyGroup(ctx, gardenTestGroup("return", "english", "english")); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := app.store.waterGarden(ctx, fmt.Sprint("return", i)); err != nil {
			t.Fatal(err)
		}
	}
	stored, _ := app.store.get(ctx)
	ledger := readGarden(t, stored)
	earned := 0
	for _, group := range ledger.Groups {
		earned += group.WaterAwarded
	}
	if earned-len(ledger.Watering) != 1 {
		t.Fatal("saved balance disappeared")
	}
}

func TestGardenConcurrentProcessesShareQuotas(t *testing.T) {
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
	first.now = func() time.Time { return gardenTestTime("2026-10-03") }
	second.now = first.now
	var workers sync.WaitGroup
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			store := first
			if index%2 == 0 {
				store = second
			}
			if _, err := store.completeStudyGroup(context.Background(), gardenTestGroup(fmt.Sprint(index), "write", fmt.Sprint(index))); err != nil {
				t.Error(err)
			}
		}(i)
	}
	workers.Wait()
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			store := first
			if index%2 == 0 {
				store = second
			}
			_, err := store.waterGarden(context.Background(), fmt.Sprint("water", index))
			var validation *patchError
			if err != nil && (!errors.As(err, &validation) || validation.code != "daily_watering_limit") {
				t.Error(err)
			}
		}(i)
	}
	workers.Wait()
	stored, _ := first.get(context.Background())
	ledger := readGarden(t, stored)
	earned := 0
	for _, group := range ledger.Groups {
		earned += group.WaterAwarded
	}
	if len(ledger.Groups) != 12 || earned != 3 || len(ledger.Watering) != 3 {
		t.Fatal("cross-process quota race")
	}
}

func TestGardenCannotBeInjectedOrOverwrittenByLegacyEndpoints(t *testing.T) {
	app := testApp(t)
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	response := request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{},"garden":{"version":1,"groups":{"fake":{"waterAwarded":100}}}}}`)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	stored, _ := app.store.get(context.Background())
	if decodeState(t, stored.Payload)["garden"] != nil {
		t.Fatal("PUT forged garden")
	}
	group := gardenTestGroup("real", "write", "real")
	original, err := app.store.completeStudyGroup(context.Background(), group)
	if err != nil {
		t.Fatal(err)
	}
	// Equal timestamps also used to overwrite the full state; both equal and
	// later attempts must now preserve the evidence and schedules, not only water.
	for _, timestamp := range []int64{original.UpdatedAt, original.UpdatedAt + 1000} {
		for _, payload := range []string{`{"items":{}}`, `{"items":{},"garden":{"version":1,"groups":{},"watering":{},"gifts":{}}}`} {
			response = request(app, http.MethodPut, "/api/progress", fmt.Sprintf(`{"payload":%s,"clientUpdatedAt":%d}`, payload, timestamp))
			if response.Code != http.StatusConflict {
				t.Fatalf("legacy overwrite accepted: %d %s", response.Code, response.Body.String())
			}
			var body struct {
				Error     string          `json:"error"`
				Message   string          `json:"message"`
				Payload   json.RawMessage `json:"payload"`
				UpdatedAt int64           `json:"updatedAt"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Error != "legacy_client_upgrade_required" || body.Message == "" || body.UpdatedAt != original.UpdatedAt {
				t.Fatal("missing actionable conflict snapshot")
			}
			if !reflect.DeepEqual(decodeState(t, body.Payload), decodeState(t, original.Payload)) {
				t.Fatal("conflict returned a different snapshot")
			}
			stored, _ = app.store.get(context.Background())
			if !reflect.DeepEqual(stored, original) {
				t.Fatal("legacy PUT changed group evidence or schedules")
			}
		}
	}
	// An older PUT cannot replace anything and may continue returning current state.
	response = request(app, http.MethodPut, "/api/progress", fmt.Sprintf(`{"payload":{"items":{}},"clientUpdatedAt":%d}`, original.UpdatedAt-1))
	if response.Code != http.StatusOK {
		t.Fatalf("stale read-back rejected: %s", response.Body.String())
	}
	var stale struct {
		Kept   string `json:"kept"`
		Merged bool   `json:"merged"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &stale)
	if stale.Kept != "server" || stale.Merged {
		t.Fatal("stale PUT was treated as a write")
	}
	retry, err := app.store.completeStudyGroup(context.Background(), group)
	if err != nil || !reflect.DeepEqual(retry, original) {
		t.Fatal("original full group no longer retryable")
	}
	response = request(app, http.MethodPatch, "/api/progress", `{"operations":[{"op":"set","collection":"garden","key":"groups","value":{}}]}`)
	if response.Code != 400 {
		t.Fatal("PATCH edited garden")
	}
}

func TestEmptyGardenKeepsLegacyPUTCompatibility(t *testing.T) {
	app := testApp(t)
	_, err := app.store.db.Exec(`INSERT INTO progress(id,payload,updated_at) VALUES(1,?,1)`, `{"items":{},"garden":{"version":1,"groups":{},"watering":{},"gifts":{}}}`)
	if err != nil {
		t.Fatal(err)
	}
	response := request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{"legacy":{"learned":true}}},"clientUpdatedAt":2}`)
	if response.Code != http.StatusOK {
		t.Fatalf("empty garden broke old client: %s", response.Body.String())
	}
	stored, _ := app.store.get(context.Background())
	if decodeState(t, decodeState(t, stored.Payload)["items"])["legacy"] == nil {
		t.Fatal("legacy update was not saved")
	}
}

func TestStudyGroupRejectsInvalidWholeGroupWithoutPartialWrites(t *testing.T) {
	mutations := map[string]func(*studyGroupRequest){
		"short":          func(g *studyGroupRequest) { g.Entries = g.Entries[:4] },
		"duplicate":      func(g *studyGroupRequest) { g.Entries[1].ID = g.Entries[0].ID },
		"unknown":        func(g *studyGroupRequest) { g.Type = "other" },
		"wrong skill":    func(g *studyGroupRequest) { g.Entries[0].Skill = "hanzi-recognition" },
		"practice only":  func(g *studyGroupRequest) { g.Entries[0].Source = "practice" },
		"wrong source":   func(g *studyGroupRequest) { g.Entries[0].Source = "automatic" },
		"unknown result": func(g *studyGroupRequest) { g.Entries[0].Result = "passed" },
		"invalid hint":   func(g *studyGroupRequest) { g.Entries[0].Details["afterPractice"] = "false" },
		"bad id":         func(g *studyGroupRequest) { g.ID = "__proto__" },
	}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			app := testApp(t)
			group := gardenTestGroup("group", "write", "字")
			change(&group)
			_, err := app.store.completeStudyGroup(context.Background(), group)
			gardenErrorCode(t, err, "invalid_study_group")
			stored, _ := app.store.get(context.Background())
			if stored.Found {
				t.Fatal("invalid group wrote progress")
			}
		})
	}
	for _, correct := range []any{-1, 11, 1.5, "10", nil} {
		app := testApp(t)
		group := gardenTestGroup("math", "math", "math")
		group.Entries[0].Details["correct"] = correct
		_, err := app.store.completeStudyGroup(context.Background(), group)
		gardenErrorCode(t, err, "invalid_study_group")
	}
}

func TestGardenHTTPContract(t *testing.T) {
	app := testApp(t)
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	group := gardenTestGroup("http", "english", "word")
	body, _ := json.Marshal(group)
	response := request(app, http.MethodPost, "/api/study-groups", string(body))
	if response.Code != 200 {
		t.Fatalf("group HTTP: %d %s", response.Code, response.Body.String())
	}
	response = request(app, http.MethodPost, "/api/garden/water", `{"id":"water-http"}`)
	if response.Code != 200 {
		t.Fatalf("water HTTP: %d %s", response.Code, response.Body.String())
	}
	for _, path := range []string{"/api/study-groups", "/api/garden/water"} {
		if response := request(app, http.MethodGet, path, ""); response.Code != 405 {
			t.Fatal("wrong method allowed")
		}
		for _, invalid := range []string{"null", "{}", `{"id":"test","unknown":true}`, "{} {}"} {
			if response := request(app, http.MethodPost, path, invalid); response.Code != 400 {
				t.Fatalf("%s %s accepted: %d", path, invalid, response.Code)
			}
		}
	}
}
