package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestLoadWritingCharactersUsesBundledFilesAndFailsClosed(t *testing.T) {
	public, err := os.OpenRoot("../public")
	if err != nil {
		t.Fatal(err)
	}
	defer public.Close()
	characters, err := loadWritingCharacters(public)
	if err != nil || !characters["木"] || !characters["辰"] || characters["龘"] {
		t.Fatalf("unexpected available stroke data: %v %v", characters, err)
	}
	for _, emptyDirectory := range []bool{false, true} {
		root := t.TempDir()
		if emptyDirectory {
			if err := os.MkdirAll(filepath.Join(root, "data", "strokes"), 0700); err != nil {
				t.Fatal(err)
			}
		}
		missing, err := os.OpenRoot(root)
		if err != nil {
			t.Fatal(err)
		}
		if characters, err := loadWritingCharacters(missing); err == nil || characters != nil {
			t.Fatal("missing stroke assets silently became an empty pruning set")
		}
		missing.Close()
	}
}

func TestWritingDraftMigrationKeepsCompletedPrefixAndSupportedCustomCharacters(t *testing.T) {
	app := testApp(t)
	ctx := context.Background()
	current := gardenTestTime("2026-10-03")
	app.store.now = func() time.Time { return current }
	for id, character := range map[string]string{"done-custom": "龘", "missing-custom": "龘", "available-custom": "辰"} {
		raw, _ := json.Marshal(map[string]string{"id": id, "c": character})
		if _, err := app.store.patch(ctx, []progressOperation{{Op: "set", Collection: "customCharacters", Key: id, Value: raw}}); err != nil {
			t.Fatal(err)
		}
	}
	group := gardenTestGroup("old-writing-plan", "write", "legacy")
	group.Entries = group.Entries[:4]
	for index, id := range []string{"done-custom", "missing-custom", "available-custom", "write-char-6728"} {
		group.Entries[index].ID = id
	}
	draft := sessionFor(group)
	draft.Entries = group.Entries[:1]
	before, err := app.store.saveStudySession(ctx, draft)
	if err != nil {
		t.Fatal(err)
	}
	original := savedSession(t, before, group.ID)
	app.store.writingCharacters = map[string]bool{"木": true, "辰": true}
	current = gardenTestTime("2026-10-04")
	stored, err := app.store.get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	after := savedSession(t, stored, group.ID)
	if len(after.Items) != 3 || after.Items[0].ID != "done-custom" || after.Items[1].ID != "available-custom" || after.Items[2].ID != "write-char-6728" {
		t.Fatalf("unexpected pruned plan: %+v", after.Items)
	}
	if !reflect.DeepEqual(original.Entries, after.Entries) || original.CreatedAt != after.CreatedAt || original.UpdatedAt != after.UpdatedAt {
		t.Fatal("migration changed completed evidence or its exposure date")
	}
	if len(decodeState(t, decodeState(t, stored.Payload)["activity"])) != 0 || len(readGarden(t, stored).Groups) != 0 {
		t.Fatal("migration created learning results or rewards")
	}
	repeated, err := app.store.get(ctx)
	if err != nil || !reflect.DeepEqual(stored, repeated) {
		t.Fatal("draft migration is not idempotent")
	}
	if _, err := app.store.saveStudySession(ctx, after.studySessionRequest); err != nil {
		t.Fatalf("migrated draft cannot resume: %v", err)
	}
}

func TestWritingDraftMigrationFinishesSavedPrefixOrDeletesEmptyPlan(t *testing.T) {
	for _, hasCompletedPrefix := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty", true: "completed-prefix"}[hasCompletedPrefix], func(t *testing.T) {
			app := testApp(t)
			ctx := context.Background()
			app.store.now = func() time.Time { return gardenTestTime("2026-10-03") }
			group := gardenTestGroup("old-unsupported", "write", "legacy")
			group.Entries = group.Entries[:2]
			group.Entries[0].ID, group.Entries[1].ID = "write-char-6728", "write-char-9f98"
			draft := sessionFor(group)
			if hasCompletedPrefix {
				draft.Entries = group.Entries[:1]
			} else {
				draft.Items = draft.Items[1:]
			}
			if _, err := app.store.saveStudySession(ctx, draft); err != nil {
				t.Fatal(err)
			}
			app.store.writingCharacters = map[string]bool{"木": true}
			stored, err := app.store.get(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if !hasCompletedPrefix {
				state := decodeState(t, stored.Payload)
				activity, err := gardenCollection(state, "activity")
				if err != nil {
					t.Fatal(err)
				}
				if len(decodeState(t, state["studySessions"])) != 0 || len(activity) != 0 || len(readGarden(t, stored).Groups) != 0 {
					t.Fatal("empty unavailable plan left results or a pending session")
				}
				return
			}
			remaining := savedSession(t, stored, group.ID)
			if len(remaining.Items) != 1 || len(remaining.Entries) != 1 {
				t.Fatal("finished prefix is not ready for normal finalization")
			}
			if _, err := app.store.saveStudySession(ctx, remaining.studySessionRequest); err != nil {
				t.Fatal(err)
			}
			group.Entries = remaining.Entries
			completed, err := app.store.completeStudyGroup(ctx, group)
			if err != nil {
				t.Fatal(err)
			}
			if readGarden(t, completed).Groups[group.ID].Count != 1 || len(decodeState(t, decodeState(t, completed.Payload)["activity"])) != 1 {
				t.Fatal("normal finalization counted an unsupported unattempted character")
			}
		})
	}
}

func TestWritingDraftRejectsNewUnfinishedUnavailableCharacter(t *testing.T) {
	app := testApp(t)
	app.store.writingCharacters = map[string]bool{"木": true}
	group := automaticWritingGroup("new-unsupported")
	draft := sessionFor(group)
	draft.Items[0].ID = "write-char-9f98"
	_, err := app.store.saveStudySession(context.Background(), draft)
	gardenErrorCode(t, err, "study_session_conflict")
	if stored, err := app.store.get(context.Background()); err != nil || stored.Found {
		t.Fatal("unavailable plan changed progress")
	}
}
