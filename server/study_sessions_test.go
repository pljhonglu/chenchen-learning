package main

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"sync"
	"testing"
	"time"
)

func sessionFor(group studyGroupRequest) studySessionRequest {
	request := studySessionRequest{ID: group.ID, Type: group.Type, Mode: group.Mode, Entries: []studyEntry{}}
	for _, entry := range group.Entries {
		request.Items = append(request.Items, studySessionItem{ID: entry.ID, Type: group.Type, Title: entry.Title, Phase: group.Mode})
	}
	return request
}

func savedSession(t *testing.T, stored progress, id string) studySession {
	t.Helper()
	var session studySession
	state := decodeState(t, stored.Payload)
	sessions := decodeState(t, state["studySessions"])
	if err := json.Unmarshal(sessions[id], &session); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestStudySessionResumesAcrossDaysAndPreservesFirstAnswerTimes(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	current := gardenTestTime("2026-10-03")
	app.store.now = func() time.Time { return current }
	group := gardenTestGroup("overnight", "write", "字")
	group.Entries = group.Entries[:2]
	group.Mode = "review"
	for _, entry := range group.Entries {
		value, _ := json.Marshal(map[string]any{"id": entry.ID, "type": "write", "learned": true, "stage": 3, "nextReview": "2026-10-03"})
		if _, err := app.store.patch(ctx, []progressOperation{{Op: "set", Collection: "items", Key: entry.ID, Value: value}}); err != nil {
			t.Fatal(err)
		}
	}
	request := sessionFor(group)
	first, err := app.store.saveStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := app.store.saveStudySession(ctx, request)
	if err != nil || !reflect.DeepEqual(first, repeated) {
		t.Fatalf("create retry changed state: %v", err)
	}
	request.Entries = group.Entries[:1]
	request.Entries[0].Day = "2099-01-01"
	request.Entries[0].At = "2099-01-01T00:00:00Z"
	partial, err := app.store.saveStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if savedSession(t, partial, group.ID).Entries[0].Day != "2026-10-03" {
		t.Fatal("client answer date trusted")
	}
	if len(decodeState(t, decodeState(t, partial.Payload)["activity"])) != 0 || len(readGarden(t, partial).Groups) != 0 {
		t.Fatal("draft created completed history or rewards")
	}
	current = gardenTestTime("2026-10-04")
	repeated, err = app.store.saveStudySession(ctx, request)
	if err != nil || !reflect.DeepEqual(partial, repeated) {
		t.Fatalf("overnight retry changed first answer time: %v", err)
	}
	completed, err := app.store.completeStudyGroup(ctx, group)
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, completed.Payload)
	items := decodeState(t, state["items"])
	activity := decodeState(t, state["activity"])
	assertSchedule(t, decodeState(t, items[group.Entries[0].ID]), 4, "2026-10-10", "remember")
	assertSchedule(t, decodeState(t, items[group.Entries[1].ID]), 4, "2026-10-11", "remember")
	if jsonString(decodeState(t, activity["study-group:overnight:0"])["day"]) != "2026-10-03" || jsonString(decodeState(t, activity["study-group:overnight:1"])["day"]) != "2026-10-04" {
		t.Fatal("completion overwrote item answer dates")
	}
	if len(decodeState(t, state["studySessions"])) != 0 || readGarden(t, completed).Groups[group.ID].Day != "2026-10-04" {
		t.Fatal("draft not cleared or reward assigned to wrong day")
	}
	retry, err := app.store.completeStudyGroup(ctx, group)
	if err != nil || !reflect.DeepEqual(completed, retry) {
		t.Fatal("completion retry changed history")
	}
	lateDraft, err := app.store.saveStudySession(ctx, request)
	if err != nil || !reflect.DeepEqual(completed, lateDraft) {
		t.Fatal("late draft retry recreated a completed session")
	}
}

func TestStudySessionRejectsRewrittenPrefixAndConcurrentPlans(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
	group := gardenTestGroup("prefix", "write", "字")
	group.Entries = group.Entries[:2]
	request := sessionFor(group)
	request.Entries = group.Entries[:1]
	original, err := app.store.saveStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	var requests []studySessionRequest
	raw, _ := json.Marshal(request)
	for index := 0; index < 4; index++ {
		var changed studySessionRequest
		_ = json.Unmarshal(raw, &changed)
		requests = append(requests, changed)
	}
	requests[0].Entries = nil
	requests[1].Entries[0].Result = "again"
	requests[2].Items[0], requests[2].Items[1] = requests[2].Items[1], requests[2].Items[0]
	requests[3].ID = "another"
	for index, changed := range requests {
		_, err := app.store.saveStudySession(ctx, changed)
		if err == nil {
			t.Fatalf("invalid update %d accepted", index)
		}
		after, _ := app.store.get(ctx)
		if !reflect.DeepEqual(original, after) {
			t.Fatalf("invalid update %d changed state", index)
		}
	}
	changed := group
	changed.Entries = append([]studyEntry{}, group.Entries...)
	changed.Entries[0].Result = "again"
	_, err = app.store.completeStudyGroup(ctx, changed)
	gardenErrorCode(t, err, "study_session_conflict")
	var wg sync.WaitGroup
	success := 0
	var mutex sync.Mutex
	for _, kind := range []string{"a", "b"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			g := gardenTestGroup(id, "pinyin", id)
			r := sessionFor(g)
			if _, err := app.store.saveStudySession(ctx, r); err == nil {
				mutex.Lock()
				success++
				mutex.Unlock()
			}
		}(kind)
	}
	wg.Wait()
	if success != 1 {
		t.Fatalf("concurrent plans created: %d", success)
	}
}

func TestStudySessionDeleteHTTPAndLegacyProtection(t *testing.T) {
	app := testApp(t)
	group := gardenTestGroup("draft", "write", "字")
	group.Entries = group.Entries[:1]
	requestBody, _ := json.Marshal(sessionFor(group))
	response := request(app, http.MethodPost, "/api/study-sessions", string(requestBody))
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	before, _ := app.store.get(context.Background())
	response = request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{}},"clientUpdatedAt":9007199254740000}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("legacy PUT erased draft: %s", response.Body.String())
	}
	if _, err := app.store.patch(context.Background(), []progressOperation{operation("set", "studySessions", "forged", `{}`)}); err == nil {
		t.Fatal("PATCH can forge drafts")
	}
	after, _ := app.store.get(context.Background())
	if !reflect.DeepEqual(before, after) {
		t.Fatal("rejected write changed draft")
	}
	for index := 0; index < 2; index++ {
		response = request(app, http.MethodDelete, "/api/study-sessions?id=draft", "")
		if response.Code != http.StatusOK {
			t.Fatal(response.Body.String())
		}
	}
	state, _ := app.store.get(context.Background())
	if len(decodeState(t, decodeState(t, state.Payload)["studySessions"])) != 0 {
		t.Fatal("draft not deleted")
	}
}

func TestSessionCompletionRejectsDeletedReviewItem(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	group := gardenTestGroup("mixed", "write", "字")
	group.Entries = group.Entries[:1]
	entry := group.Entries[0]
	if _, err := app.store.patch(ctx, []progressOperation{operation("set", "items", entry.ID, `{"type":"write","learned":true,"nextReview":"2026-10-03"}`)}); err != nil {
		t.Fatal(err)
	}
	draft := sessionFor(group)
	draft.Items[0].Phase = "review"
	if _, err := app.store.saveStudySession(ctx, draft); err != nil {
		t.Fatal(err)
	}
	if _, err := app.store.patch(ctx, []progressOperation{operation("delete", "items", entry.ID, "")}); err != nil {
		t.Fatal(err)
	}
	before, _ := app.store.get(ctx)
	_, err := app.store.completeStudyGroup(ctx, group)
	gardenErrorCode(t, err, "study_session_conflict")
	after, _ := app.store.get(ctx)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("completion restored deleted item")
	}
}

func TestShortGroupsAndPoemsNeedNoLearnedFlag(t *testing.T) {
	for _, kind := range []string{"poem", "write", "pinyin", "english"} {
		t.Run(kind, func(t *testing.T) {
			app := testApp(t)
			app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
			group := gardenTestGroup("short", kind, kind)
			group.Entries = group.Entries[:1]
			if kind == "poem" {
				group.Mode = "review"
				if _, err := app.store.patch(context.Background(), []progressOperation{operation("set", "items", group.Entries[0].ID, `{"type":"poem","stage":2,"nextReview":"2026-10-03"}`)}); err != nil {
					t.Fatal(err)
				}
			}
			stored, err := app.store.completeStudyGroup(context.Background(), group)
			if err != nil {
				t.Fatal(err)
			}
			if readGarden(t, stored).Groups["short"].Count != 1 {
				t.Fatal("short group count is not actual count")
			}
			if kind == "poem" && decodeState(t, progressItems(t, stored)[group.Entries[0].ID])["learned"] != nil {
				t.Fatal("completion recreated learned flag")
			}
		})
	}
}

func TestAllPoemsMigrateAndLegacyWritesCannotRestoreLearned(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	payload := json.RawMessage(`{"items":{"custom":{"type":"poem","learned":false,"stage":4,"nextReview":"2026-12-01","reviewDay":"2026-10-01","reviewStartStage":3,"updatedAt":"old"},"write":{"type":"write","learned":true}},"customPoems":{"custom":{"title":"自定义诗"},"new-custom":{"title":"新诗"}}}`)
	stored, _, err := app.store.put(ctx, payload, 1)
	if err != nil {
		t.Fatal(err)
	}
	custom := decodeState(t, progressItems(t, stored)["custom"])
	if custom["learned"] != nil || string(custom["stage"]) != "4" || jsonString(custom["nextReview"]) != "2026-12-01" || jsonString(custom["reviewDay"]) != "2026-10-01" || jsonString(custom["updatedAt"]) != "old" {
		t.Fatalf("migration reset schedule: %s", mustJSON(custom))
	}
	if progressItems(t, stored)["new-custom"] == nil || string(decodeState(t, progressItems(t, stored)["write"])["learned"]) != "true" {
		t.Fatal("migration missed custom poem or changed other subject")
	}
	stored, err = app.store.patch(ctx, []progressOperation{operation("merge", "items", "custom", `{"learned":true}`)})
	if err != nil {
		t.Fatal(err)
	}
	if decodeState(t, progressItems(t, stored)["custom"])["learned"] != nil {
		t.Fatal("legacy PATCH restored learned")
	}
	next, err := app.store.get(ctx)
	if err != nil || !reflect.DeepEqual(stored, next) {
		t.Fatal("migration is not idempotent")
	}
}

func TestDeletedCustomPoemDoesNotReturnThroughMigrationOrLegacyPut(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	seed := json.RawMessage(`{"items":{"custom":{"type":"poem","learned":true,"stage":3,"nextReview":"2026-12-01"}},"customPoems":{"custom":{"title":"自定义"}}}`)
	if _, _, err := app.store.put(ctx, seed, 1); err != nil {
		t.Fatal(err)
	}
	removed, err := app.store.patch(ctx, []progressOperation{operation("delete", "items", "custom", "")})
	if err != nil {
		t.Fatal(err)
	}
	if progressItems(t, removed)["custom"] != nil {
		t.Fatal("migration restored a deleted custom poem")
	}
	stored, _, err := app.store.put(ctx, seed, removed.UpdatedAt+100)
	if err != nil {
		t.Fatal(err)
	}
	if progressItems(t, stored)["custom"] != nil {
		t.Fatal("legacy PUT erased custom poem removal")
	}
}
