package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type classroomPoem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func loadClassroomPoems(public *os.Root) ([]classroomPoem, error) {
	contents, err := public.ReadFile("data/poems.json")
	if err != nil {
		return nil, fmt.Errorf("read classroom poems: %w", err)
	}
	var poems []classroomPoem
	if err := json.Unmarshal(contents, &poems); err != nil || len(poems) == 0 {
		return nil, errors.New("classroom poems must be a nonempty JSON array")
	}
	seen := make(map[string]bool)
	for _, poem := range poems {
		if strings.TrimSpace(poem.ID) == "" || strings.TrimSpace(poem.Title) == "" || seen[poem.ID] {
			return nil, errors.New("classroom poems require unique IDs and titles")
		}
		seen[poem.ID] = true
	}
	return poems, nil
}

func (s *progressStore) isBuiltinPoem(id string) bool {
	for _, poem := range s.builtinPoems {
		if poem.ID == id {
			return true
		}
	}
	return false
}

func (s *progressStore) retainPoemRemovals(payload json.RawMessage, previous progress) (json.RawMessage, error) {
	if !previous.Found {
		return payload, nil
	}
	var before, next map[string]json.RawMessage
	if err := json.Unmarshal(previous.Payload, &before); err != nil {
		return nil, err
	}
	var removed map[string]json.RawMessage
	if err := json.Unmarshal(before["hiddenCourses"], &removed); err != nil || len(removed) == 0 {
		return payload, nil
	}
	if err := json.Unmarshal(payload, &next); err != nil || next == nil {
		return nil, errors.New("progress must be an object")
	}
	hidden := make(map[string]json.RawMessage)
	if raw, exists := next["hiddenCourses"]; exists {
		if err := json.Unmarshal(raw, &hidden); err != nil || hidden == nil {
			return nil, errors.New("hiddenCourses must be an object")
		}
	}
	changed := false
	for id, tombstone := range removed {
		if s.isBuiltinPoem(id) {
			hidden[id] = tombstone
			changed = true
		}
	}
	if !changed {
		return payload, nil
	}
	next["hiddenCourses"], _ = json.Marshal(hidden)
	return json.Marshal(next)
}

// The built-in poems were all taught in class. Enroll them in the same write
// transaction as every read/update, so a stale browser cannot reset progress.
// Tombstones make a parent's explicit removal survive reads and restarts.
func (s *progressStore) ensureBuiltinPoems(ctx context.Context, tx *sql.Tx, stored progress, now time.Time) (progress, error) {
	if len(s.builtinPoems) == 0 {
		return stored, nil
	}
	state := make(map[string]json.RawMessage)
	if stored.Found {
		if err := json.Unmarshal(stored.Payload, &state); err != nil || state == nil {
			return progress{}, errors.New("stored progress must be an object")
		}
	}
	items := make(map[string]json.RawMessage)
	if raw, exists := state["items"]; exists {
		if err := json.Unmarshal(raw, &items); err != nil || items == nil {
			return progress{}, errors.New("stored items must be an object")
		}
	}
	hidden := make(map[string]json.RawMessage)
	if raw, exists := state["hiddenCourses"]; exists {
		if err := json.Unmarshal(raw, &hidden); err != nil || hidden == nil {
			return progress{}, errors.New("stored hiddenCourses must be an object")
		}
	}
	// The app is used in China; Docker's UTC timezone must not shift review dates.
	today := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	timestamp := now.UTC().Format(time.RFC3339Nano)
	changed := false
	for _, poem := range s.builtinPoems {
		if _, removed := hidden[poem.ID]; removed {
			if _, exists := items[poem.ID]; exists {
				delete(items, poem.ID)
				changed = true
			}
			continue
		}
		item := make(map[string]json.RawMessage)
		raw, exists := items[poem.ID]
		if exists {
			if err := json.Unmarshal(raw, &item); err != nil || item == nil {
				return progress{}, fmt.Errorf("stored poem %q must be an object", poem.ID)
			}
		}
		itemChanged := false
		set := func(key string, value any) {
			item[key], _ = json.Marshal(value)
			itemChanged = true
		}
		for key, value := range map[string]any{
			"id": poem.ID, "type": "poem", "title": poem.Title,
			"stage": 0, "lastResult": "enrolled", "createdAt": timestamp,
		} {
			if _, present := item[key]; !present {
				set(key, value)
			}
		}
		if string(item["learned"]) != "true" {
			set("learned", true)
		}
		var nextReview string
		_ = json.Unmarshal(item["nextReview"], &nextReview)
		if nextReview == "" {
			set("nextReview", today)
		}
		if itemChanged {
			set("updatedAt", timestamp)
			items[poem.ID], _ = json.Marshal(item)
			changed = true
		}
	}
	if !changed {
		return stored, nil
	}
	updatedAt := now.UnixMilli()
	if updatedAt <= stored.UpdatedAt && stored.UpdatedAt < 9_007_199_254_740_991 {
		updatedAt = stored.UpdatedAt + 1
	}
	state["items"], _ = json.Marshal(items)
	state["updatedAt"], _ = json.Marshal(updatedAt)
	payload, err := json.Marshal(state)
	if err != nil {
		return progress{}, err
	}
	if len(payload) > maxProgressBytes {
		return progress{}, &patchError{http.StatusRequestEntityTooLarge, "payload too large", "poem enrollment exceeds progress storage limit"}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO progress (id, payload, updated_at)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`, string(payload), updatedAt); err != nil {
		return progress{}, err
	}
	return progress{Payload: payload, UpdatedAt: updatedAt, Found: true}, nil
}
