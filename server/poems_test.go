package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func testClassroomPoems(t *testing.T) []classroomPoem {
	t.Helper()
	root, err := os.OpenRoot("../public")
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	poems, err := loadClassroomPoems(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(poems) != 35 {
		t.Fatalf("expected all 35 classroom poems, got %d", len(poems))
	}
	return poems
}

func progressItems(t *testing.T, stored progress) map[string]json.RawMessage {
	t.Helper()
	return decodeState(t, decodeState(t, stored.Payload)["items"])
}

func TestPoemsAutomaticallyStartReviewAndInitializationIsIdempotent(t *testing.T) {
	app := testApp(t)
	app.store.builtinPoems = testClassroomPoems(t)
	response := request(app, http.MethodGet, "/api/progress", "")
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	first, err := app.store.get(context.Background())
	if err != nil || !first.Found {
		t.Fatalf("get: %+v, %v", first, err)
	}
	items := progressItems(t, first)
	if len(items) != 35 {
		t.Fatalf("initial poem count = %d", len(items))
	}
	for _, poem := range app.store.builtinPoems {
		item := decodeState(t, items[poem.ID])
		if string(item["learned"]) != "true" || string(item["type"]) != `"poem"` || string(item["stage"]) != "0" {
			t.Fatalf("initial review item: %s", items[poem.ID])
		}
	}
	second, err := app.store.get(context.Background())
	if err != nil || first.UpdatedAt != second.UpdatedAt || string(first.Payload) != string(second.Payload) {
		t.Fatalf("a repeated GET changed progress: %v", err)
	}
}

func TestPoemMigrationPreservesProgressAndUsesShanghaiReviewDate(t *testing.T) {
	app := testApp(t)
	seed := json.RawMessage(`{"items":{"poem-01":{"id":"poem-01","type":"poem","title":"旧标题","learned":true,"stage":4,"nextReview":"2026-11-10","reviewDay":"2026-09-30","reviewStartStage":3,"lastResult":"remember","createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-30T00:00:00Z"},"poem-02":{"id":"poem-02","type":"poem","title":"诗二","learned":false,"stage":3,"nextReview":"2026-11-08","createdAt":"old"},"math":{"learned":false,"stage":2}},"future":{"preserve":true}}`)
	if _, _, err := app.store.put(context.Background(), seed, 100); err != nil {
		t.Fatal(err)
	}
	app.store.builtinPoems = testClassroomPoems(t)
	tx, err := app.store.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	before := progress{Payload: seed, Found: true, UpdatedAt: 100}
	// Still September 30 in UTC, already October 1 for the child's review.
	now := time.Date(2026, 9, 30, 17, 0, 0, 0, time.UTC)
	stored, err := app.store.ensureBuiltinPoems(context.Background(), tx, before, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	items, oldItems := progressItems(t, stored), progressItems(t, before)
	if !reflect.DeepEqual(decodeState(t, items["poem-01"]), decodeState(t, oldItems["poem-01"])) {
		t.Fatalf("active review was reset: %s", items["poem-01"])
	}
	paused := decodeState(t, items["poem-02"])
	if string(paused["learned"]) != "true" || string(paused["stage"]) != "3" || string(paused["nextReview"]) != `"2026-11-08"` || string(paused["createdAt"]) != `"old"` {
		t.Fatalf("existing stage or dates changed: %s", items["poem-02"])
	}
	newItem := decodeState(t, items["poem-03"])
	if string(newItem["nextReview"]) != `"2026-10-01"` || string(items["math"]) != string(oldItems["math"]) || string(decodeState(t, stored.Payload)["future"]) != `{"preserve":true}` {
		t.Fatalf("wrong date or unrelated changes: %s", stored.Payload)
	}
}

func TestRemovedPoemStaysRemovedUntilExplicitRestore(t *testing.T) {
	app := testApp(t)
	app.store.builtinPoems = testClassroomPoems(t)
	ctx := context.Background()
	// A PATCH before the first GET also enrolls the classroom poems.
	stored, err := app.store.patch(ctx, []progressOperation{operation("merge", "items", "poem-01", `{"stage":3,"nextReview":"2026-11-01"}`)})
	if err != nil || len(progressItems(t, stored)) != 35 {
		t.Fatalf("initial PATCH: %v", err)
	}
	if _, err := app.store.patch(ctx, []progressOperation{operation("delete", "items", "poem-01", "")}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		stored, err = app.store.get(ctx)
		if err != nil || progressItems(t, stored)["poem-01"] != nil || decodeState(t, decodeState(t, stored.Payload)["hiddenCourses"])["poem-01"] == nil {
			t.Fatalf("removed poem reappeared: %v %s", err, stored.Payload)
		}
	}
	// Old clients can still submit snapshots without hiddenCourses. They
	// must not resurrect a removed poem even with a newer client timestamp.
	stored, _, err = app.store.put(ctx, json.RawMessage(`{"items":{"poem-01":{"learned":true}}}`), stored.UpdatedAt+100)
	if err != nil || progressItems(t, stored)["poem-01"] != nil {
		t.Fatalf("legacy PUT resurrected a removed poem: %v", err)
	}
	reopened, err := openStore(filepath.Dir(app.store.path))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	reopened.builtinPoems = app.store.builtinPoems
	afterRestart, err := reopened.get(ctx)
	if err != nil || progressItems(t, afterRestart)["poem-01"] != nil {
		t.Fatalf("restart resurrected a removed poem: %v", err)
	}
	// An old device's stale enrollment must not undo a parent's deletion.
	if _, err := app.store.patch(ctx, []progressOperation{operation("create", "items", "poem-01", `{"learned":true}`)}); err == nil {
		t.Fatal("stale enrollment unexpectedly restored the removed poem")
	}
	if _, err := app.store.patch(ctx, []progressOperation{
		operation("delete", "hiddenCourses", "poem-01", ""),
		operation("create", "items", "poem-01", `{"id":"poem-01","type":"poem","title":"诗卡","learned":true,"stage":0,"nextReview":"2026-10-01"}`),
	}); err != nil {
		t.Fatal(err)
	}
	stored, err = app.store.get(ctx)
	if err != nil || len(progressItems(t, stored)) != 35 {
		t.Fatalf("restore: %v", err)
	}
}

func TestPutBeforeFirstReadIncludesClassroomPoems(t *testing.T) {
	app := testApp(t)
	app.store.builtinPoems = testClassroomPoems(t)
	stored, kept, err := app.store.put(context.Background(), json.RawMessage(`{"items":{"math":{"title":"数学","stage":2,"nextReview":"2026-11-01"}}}`), 100)
	if err != nil || kept != "client" {
		t.Fatalf("put: %s, %v", kept, err)
	}
	items := progressItems(t, stored)
	if len(items) != 36 || string(decodeState(t, items["math"])["stage"]) != "2" {
		t.Fatalf("PUT omitted poems or changed math: %s", stored.Payload)
	}
}

func TestConcurrentPoemInitializationCannotOverwriteReview(t *testing.T) {
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
	first.builtinPoems = testClassroomPoems(t)
	second.builtinPoems = first.builtinPoems
	var work sync.WaitGroup
	for i := 0; i < 20; i++ {
		work.Add(1)
		go func(i int) {
			defer work.Done()
			if i%2 == 0 {
				_, err := first.get(context.Background())
				if err != nil {
					t.Error(err)
				}
			} else {
				_, err := second.patch(context.Background(), []progressOperation{operation("merge", "items", "poem-01", `{"stage":4,"nextReview":"2026-11-15"}`)})
				if err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	work.Wait()
	stored, err := first.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	items := progressItems(t, stored)
	item := decodeState(t, items["poem-01"])
	if len(items) != 35 || string(item["stage"]) != "4" || string(item["nextReview"]) != `"2026-11-15"` {
		t.Fatalf("concurrent initialization reset review: %s", stored.Payload)
	}
}
