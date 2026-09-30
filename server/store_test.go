package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestExistingPythonDatabaseAndPersistence(t *testing.T) {
	dir := t.TempDir()
	// Seed precisely the schema and UTF-8 payload written by the old service.
	legacy, err := sql.Open("sqlite", filepath.Join(dir, "progress.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = legacy.Exec(`CREATE TABLE IF NOT EXISTS progress (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              payload TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            )`); err != nil {
		t.Fatal(err)
	}
	seed := `{"items":{"poem-1":{"title":"静夜思","level":2}},"updatedAt":100}`
	if _, err = legacy.Exec("INSERT INTO progress (id, payload, updated_at) VALUES (1, ?, ?)", seed, 100); err != nil {
		t.Fatal(err)
	}
	if err = legacy.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := store.get(context.Background())
	if err != nil || !initial.Found || string(initial.Payload) != seed || initial.UpdatedAt != 100 {
		t.Fatalf("legacy progress = %+v, error = %v", initial, err)
	}
	updated := json.RawMessage(`{"items":{"poem-1":{"title":"静夜思","level":3}},"updatedAt":200}`)
	if _, kept, err := store.put(context.Background(), updated, 200); err != nil || kept != "client" {
		t.Fatalf("update kept=%q, error=%v", kept, err)
	}
	if err = store.db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	persisted, err := store.get(context.Background())
	if err != nil || !persisted.Found || string(persisted.Payload) != string(updated) || persisted.UpdatedAt != 200 {
		t.Fatalf("persisted progress = %+v, error = %v", persisted, err)
	}
}

func TestLastWriteWinsIncludingEqualTimestamps(t *testing.T) {
	store, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	ctx := context.Background()
	for _, tc := range []struct {
		stamp int64
		name  string
		kept  string
		want  string
	}{
		{200, "new", "client", "new"},
		{100, "old", "server", "new"},
		{200, "equal", "client", "equal"},
		{300, "newest", "client", "newest"},
	} {
		payload := json.RawMessage(fmt.Sprintf(`{"items":{},"name":%q}`, tc.name))
		stored, kept, err := store.put(ctx, payload, tc.stamp)
		if err != nil || kept != tc.kept {
			t.Fatalf("put(%s): kept=%q, error=%v", tc.name, kept, err)
		}
		var value struct{ Name string }
		if err := json.Unmarshal(stored.Payload, &value); err != nil || value.Name != tc.want {
			t.Fatalf("put(%s): payload=%s, error=%v", tc.name, stored.Payload, err)
		}
	}
}

func TestConcurrentWritesKeepNewestProgress(t *testing.T) {
	store, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	const count = 40
	var writes sync.WaitGroup
	for stamp := int64(1); stamp <= count; stamp++ {
		writes.Add(1)
		go func() {
			defer writes.Done()
			payload := json.RawMessage(fmt.Sprintf(`{"items":{},"stamp":%d}`, stamp))
			if _, _, err := store.put(context.Background(), payload, stamp); err != nil {
				t.Errorf("concurrent put: %v", err)
			}
		}()
	}
	writes.Wait()
	stored, err := store.get(context.Background())
	if err != nil || stored.UpdatedAt != count || string(stored.Payload) != `{"items":{},"stamp":40}` {
		t.Fatalf("latest progress = %+v, error = %v", stored, err)
	}
}

func TestMissingTimestampUsesServerClock(t *testing.T) {
	store, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	before := time.Now().UnixMilli()
	stored, _, err := store.put(context.Background(), json.RawMessage(`{"items":{}}`), 0)
	if err != nil || stored.UpdatedAt < before || stored.UpdatedAt > time.Now().UnixMilli() {
		t.Fatalf("server timestamp = %d, error = %v", stored.UpdatedAt, err)
	}
}
