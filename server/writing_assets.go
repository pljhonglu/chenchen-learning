package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// File presence, rather than a client-supplied list, determines which characters
// can use the bundled stroke quiz. Transient browser loading errors do not prune plans.
func loadWritingCharacters(public *os.Root) (map[string]bool, error) {
	directory, err := public.Open("data/strokes")
	if err != nil {
		return nil, fmt.Errorf("open writing stroke data: %w", err)
	}
	defer directory.Close()
	files, err := directory.ReadDir(-1)
	if err != nil {
		return nil, fmt.Errorf("read writing stroke data: %w", err)
	}
	characters := make(map[string]bool)
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		code, err := strconv.ParseInt(strings.TrimSuffix(file.Name(), ".json"), 16, 32)
		if err == nil && unicode.Is(unicode.Han, rune(code)) && file.Name() == fmt.Sprintf("%x.json", code) {
			characters[string(rune(code))] = true
		}
	}
	if len(characters) == 0 {
		return nil, errors.New("writing stroke data must contain at least one character")
	}
	return characters, nil
}

func writingPlanCharacter(id string, custom map[string]json.RawMessage) string {
	if raw, exists := custom[id]; exists {
		var character struct {
			Character string `json:"c"`
		}
		if json.Unmarshal(raw, &character) == nil {
			return character.Character
		}
	}
	if strings.HasPrefix(id, "write-char-") {
		code, err := strconv.ParseInt(strings.TrimPrefix(id, "write-char-"), 16, 32)
		if err == nil && unicode.Is(unicode.Han, rune(code)) {
			return string(rune(code))
		}
	}
	return ""
}

func (s *progressStore) validateWritingPlanAssets(state map[string]json.RawMessage, request studySessionRequest) error {
	if request.Type != "write" || s.writingCharacters == nil {
		return nil
	}
	custom, err := gardenCollection(state, "customCharacters")
	if err != nil {
		return err
	}
	for _, item := range request.Items[len(request.Entries):] {
		if !s.writingCharacters[writingPlanCharacter(item.ID, custom)] {
			return sessionConflict("这个字暂时没有自动书写数据，请同步后继续可练习的汉字")
		}
	}
	return nil
}

// Old parent-confirmed plans can contain custom characters without bundled
// strokes. Keep their completed prefix and its original timestamps; only remove
// unattempted unsupported characters. A completed prefix is finalized normally by
// the client, while an entirely empty plan disappears without history or rewards.
func (s *progressStore) pruneUnavailableWritingSessions(ctx context.Context, tx *sql.Tx, stored progress, now time.Time) (progress, error) {
	if !stored.Found || s.writingCharacters == nil {
		return stored, nil
	}
	var state map[string]json.RawMessage
	if err := json.Unmarshal(stored.Payload, &state); err != nil {
		return stored, err
	}
	sessions, err := gardenCollection(state, "studySessions")
	if err != nil {
		return stored, err
	}
	custom, err := gardenCollection(state, "customCharacters")
	if err != nil {
		return stored, err
	}
	changed := false
	for id, raw := range sessions {
		var session studySession
		if json.Unmarshal(raw, &session) != nil || len(session.Entries) > len(session.Items) {
			return stored, errors.New("stored study session is invalid")
		}
		if session.Type != "write" {
			continue
		}
		items := append([]studySessionItem{}, session.Items[:len(session.Entries)]...)
		for _, item := range session.Items[len(session.Entries):] {
			if s.writingCharacters[writingPlanCharacter(item.ID, custom)] {
				items = append(items, item)
			}
		}
		if len(items) == len(session.Items) {
			continue
		}
		changed = true
		if len(items) == 0 {
			delete(sessions, id)
			continue
		}
		session.Items = items
		sessions[id], _ = json.Marshal(session)
	}
	if !changed {
		return stored, nil
	}
	updatedAt := now.UnixMilli()
	if updatedAt <= stored.UpdatedAt && stored.UpdatedAt < 9_007_199_254_740_991 {
		updatedAt = stored.UpdatedAt + 1
	}
	state["studySessions"], _ = json.Marshal(sessions)
	state["updatedAt"], _ = json.Marshal(updatedAt)
	payload, err := json.Marshal(state)
	if err != nil {
		return stored, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE progress SET payload = ?, updated_at = ? WHERE id = 1", string(payload), updatedAt); err != nil {
		return stored, err
	}
	return progress{Payload: payload, UpdatedAt: updatedAt, Found: true}, nil
}
