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

func operation(op, collection, key, value string) progressOperation {
	return progressOperation{Op: op, Collection: collection, Key: key, Value: json.RawMessage(value)}
}

func decodeState(t *testing.T, payload json.RawMessage) map[string]json.RawMessage {
	t.Helper()
	var state map[string]json.RawMessage
	if err := json.Unmarshal(payload, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestPatchPreservesLegacyProgressAndUnknownFields(t *testing.T) {
	app := testApp(t)
	put := request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{"old":{"level":2,"title":"旧课程"}},"future":{"keep":true}},"clientUpdatedAt":123}`)
	if put.Code != http.StatusOK {
		t.Fatal(put.Body.String())
	}
	patch := request(app, http.MethodPatch, "/api/progress", `{"operations":[{"op":"merge","collection":"items","key":"old","value":{"level":3}},{"op":"set","collection":"customPoems","key":"new","value":{"title":"新课文","lines":["春天来了"]}},{"op":"set","collection":"items","key":"new","value":{"level":0}}]}`)
	var response struct {
		OK        bool            `json:"ok"`
		Payload   json.RawMessage `json:"payload"`
		UpdatedAt int64           `json:"updatedAt"`
	}
	if err := json.Unmarshal(patch.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if patch.Code != http.StatusOK || !response.OK || response.UpdatedAt <= 123 {
		t.Fatalf("PATCH: %d %s", patch.Code, patch.Body.String())
	}
	state := decodeState(t, response.Payload)
	items := decodeState(t, state["items"])
	if !strings.Contains(string(items["old"]), `"title":"旧课程"`) || !strings.Contains(string(items["old"]), `"level":3`) || len(items["new"]) == 0 || string(state["future"]) != `{"keep":true}` {
		t.Fatalf("PATCH did not preserve existing fields: %s", response.Payload)
	}
	var payloadTimestamp int64
	if json.Unmarshal(state["updatedAt"], &payloadTimestamp) != nil || payloadTimestamp != response.UpdatedAt {
		t.Fatal("server timestamp must match persisted payload")
	}
	read := request(app, http.MethodGet, "/api/progress", "")
	if !strings.Contains(read.Body.String(), `"found":true`) || !strings.Contains(read.Body.String(), `"customPoems"`) {
		t.Fatal(read.Body.String())
	}
}

func TestPatchConcurrentDevicesPreserveIndependentEntries(t *testing.T) {
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
	ctx := context.Background()
	if _, err := first.patch(ctx, []progressOperation{operation("set", "items", "shared", `{"title":"共同课程"}`)}); err != nil {
		t.Fatal(err)
	}
	const count = 30
	var writes sync.WaitGroup
	for i := 0; i < count; i++ {
		writes.Add(1)
		go func() {
			defer writes.Done()
			store := first
			if i%2 == 1 {
				store = second
			}
			ops := []progressOperation{
				operation("set", "items", fmt.Sprintf("item-%d", i), `{"level":1}`),
				operation("merge", "items", "shared", fmt.Sprintf(`{"device%d":true}`, i)),
			}
			if _, err := store.patch(ctx, ops); err != nil {
				t.Errorf("device %d patch: %v", i, err)
			}
		}()
	}
	writes.Wait()
	stored, err := first.get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, stored.Payload)
	items := decodeState(t, state["items"])
	shared := decodeState(t, items["shared"])
	if len(items) != count+1 || len(shared) != count+1 {
		t.Fatalf("concurrent data lost: %s", stored.Payload)
	}
}

func TestConcurrentCreatePreservesAlreadyReviewedCourse(t *testing.T) {
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
	ctx := context.Background()
	create := []progressOperation{
		operation("create", "items", "course", `{"stage":0,"title":"课文","nextReview":"2026-10-01"}`),
		operation("create", "customPoems", "course", `{"title":"课文"}`),
	}
	if _, err := first.patch(ctx, create); err != nil {
		t.Fatal(err)
	}
	if _, err := first.patch(ctx, []progressOperation{
		operation("merge", "items", "course", `{"stage":3,"nextReview":"2026-10-08"}`),
		operation("merge", "customPoems", "course", `{"title":"家长更正后的标题"}`),
	}); err != nil {
		t.Fatal(err)
	}
	var requests sync.WaitGroup
	for i := 0; i < 20; i++ {
		requests.Add(1)
		go func() {
			defer requests.Done()
			store := first
			if i%2 == 1 {
				store = second
			}
			if _, err := store.patch(ctx, create); err != nil {
				t.Errorf("stale enrollment retry: %v", err)
			}
		}()
	}
	requests.Wait()
	stored, err := first.get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, stored.Payload)
	items := decodeState(t, state["items"])
	poems := decodeState(t, state["customPoems"])
	if string(items["course"]) != `{"nextReview":"2026-10-08","stage":3,"title":"课文"}` || string(poems["course"]) != `{"title":"家长更正后的标题"}` {
		t.Fatalf("concurrent create overwrote existing data: %s", stored.Payload)
	}
}

func TestDeletedCourseCannotBeRevivedByLateReview(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	_, err := app.store.patch(ctx, []progressOperation{
		operation("set", "customPoems", "poem-1", `{"title":"静夜思"}`),
		operation("set", "items", "poem-1", `{"level":1}`),
		operation("set", "items", "other", `{"level":2}`),
		operation("set", "activity", "known-event", `{"id":"poem-1","day":"2026-10-01"}`),
		operation("set", "activity", "other-event", `{"id":"other","day":"2026-10-01"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Another device adds an event the deleting client has never seen.
	if _, err := app.store.patch(ctx, []progressOperation{operation("set", "activity", "new-event", `{"id":"poem-1","day":"2026-10-02"}`)}); err != nil {
		t.Fatal(err)
	}
	deleted, err := app.store.patch(ctx, []progressOperation{
		operation("delete", "customPoems", "poem-1", ""),
		operation("delete", "items", "poem-1", ""),
	})
	if err != nil {
		t.Fatal(err)
	}
	state := decodeState(t, deleted.Payload)
	if len(decodeState(t, state["items"])) != 1 || len(decodeState(t, state["customPoems"])) != 0 || len(decodeState(t, state["activity"])) != 1 {
		t.Fatalf("delete left progress or activity behind: %s", deleted.Payload)
	}
	// Even operations before the failing merge must roll back together.
	late := request(app, http.MethodPatch, "/api/progress", `{"operations":[{"op":"set","collection":"activity","key":"ghost","value":{"id":"poem-1"}},{"op":"merge","collection":"items","key":"poem-1","value":{"level":3}}]}`)
	var conflict struct {
		Error     string          `json:"error"`
		Payload   json.RawMessage `json:"payload"`
		UpdatedAt int64           `json:"updatedAt"`
	}
	if err := json.Unmarshal(late.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if late.Code != http.StatusConflict || conflict.Error != "entry_not_found" || conflict.UpdatedAt != deleted.UpdatedAt || string(conflict.Payload) != string(deleted.Payload) {
		t.Fatalf("late review: %d %s", late.Code, late.Body.String())
	}
	current, err := app.store.get(ctx)
	if err != nil || string(current.Payload) != string(deleted.Payload) {
		t.Fatalf("failed batch partially persisted: %s, %v", current.Payload, err)
	}
	// A parent may explicitly add the same built-in lesson again.
	if _, err := app.store.patch(ctx, []progressOperation{operation("set", "items", "poem-1", `{"level":0}`)}); err != nil {
		t.Fatalf("explicit re-add should work: %v", err)
	}
}

func TestInvalidPatchIsAtomic(t *testing.T) {
	app := testApp(t)
	initial, err := app.store.patch(context.Background(), []progressOperation{operation("set", "items", "keep", `{"level":2}`)})
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{}`, `null`, `{"operations":[]}`, `{"operations":null}`, `{"operations":{}}`,
		`{"operations":[{"op":"set","collection":"unknown","key":"x","value":{}}]}`,
		`{"operations":[{"op":"put","collection":"items","key":"x","value":{}}]}`,
		`{"operations":[{"op":"set","collection":"items","key":"__proto__","value":{}}]}`,
		`{"operations":[{"op":"set","collection":"items","key":"","value":{}}]}`,
		`{"operations":[{"op":"set","collection":"items","key":"x","value":[]}]}`,
		`{"operations":[{"op":"set","collection":"items","key":"x","value":null}]}`,
		`{"operations":[{"op":"delete","collection":"items","key":"keep","value":null}]}`,
		`{"operations":[{"op":"delete","collection":"items","key":"keep"}],"clientUpdatedAt":99}`,
		`{"operations":[{"op":"delete","collection":"items","key":"keep","typo":1}]}`,
		`{"operations":[{"op":"delete","collection":"items","key":"keep"},{"op":"set","collection":"items","key":"bad"}]}`,
		`{"operations":[{"op":"delete","collection":"items","key":"keep"}]} {}`,
	} {
		res := request(app, http.MethodPatch, "/api/progress", body)
		if res.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d %s", body, res.Code, res.Body.String())
		}
	}
	excessive := make([]progressOperation, maxPatchOperations+1)
	for i := range excessive {
		excessive[i] = operation("delete", "items", "keep", "")
	}
	body, _ := json.Marshal(map[string]any{"operations": excessive})
	if res := request(app, http.MethodPatch, "/api/progress", string(body)); res.Code != 400 {
		t.Errorf("oversized operation array accepted: %d", res.Code)
	}
	stored, err := app.store.get(context.Background())
	if err != nil || string(stored.Payload) != string(initial.Payload) || stored.UpdatedAt != initial.UpdatedAt {
		t.Fatalf("invalid patch changed data: %s, %v", stored.Payload, err)
	}
}

func TestPatchTotalStorageLimitRollsBack(t *testing.T) {
	app := testApp(t)
	initial, err := app.store.patch(context.Background(), []progressOperation{
		operation("set", "customPoems", "large", fmt.Sprintf(`{"text":%q}`, strings.Repeat("a", 350_000))),
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"operations": []progressOperation{
		operation("set", "customPoems", "overflow", fmt.Sprintf(`{"text":%q}`, strings.Repeat("b", 200_000))),
	}})
	response := request(app, http.MethodPatch, "/api/progress", string(body))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("storage limit: %d %s", response.Code, response.Body.String())
	}
	stored, err := app.store.get(context.Background())
	if err != nil || string(stored.Payload) != string(initial.Payload) {
		t.Fatal("overflow changed stored progress")
	}
}
