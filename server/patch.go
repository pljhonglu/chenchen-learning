package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
)

const maxPatchOperations = 100

// Operations address a single map entry rather than sending a browser's
// snapshot back to the server. Independent devices therefore keep each
// other's additions, edits, and deletions.
type progressOperation struct {
	Op         string          `json:"op"`
	Collection string          `json:"collection"`
	Key        string          `json:"key"`
	Value      json.RawMessage `json:"value,omitempty"`
}

type patchError struct {
	status  int
	code    string
	message string
}

func (e *patchError) Error() string { return e.message }

func invalidOperation(message string) error {
	return &patchError{http.StatusBadRequest, "invalid_operations", message}
}

func validateOperations(operations []progressOperation) error {
	if len(operations) < 1 || len(operations) > maxPatchOperations {
		return invalidOperation("operations must contain between 1 and 100 entries")
	}
	for index, operation := range operations {
		switch operation.Collection {
		case "items", "customPoems", "customCharacters", "activity", "hiddenCourses":
		default:
			return invalidOperation(fmt.Sprintf("operation %d: unknown collection", index))
		}
		if operation.Key == "" || len(operation.Key) > 200 || strings.TrimSpace(operation.Key) != operation.Key ||
			strings.ContainsFunc(operation.Key, unicode.IsControl) || operation.Key == "__proto__" ||
			operation.Key == "prototype" || operation.Key == "constructor" {
			return invalidOperation(fmt.Sprintf("operation %d: invalid key", index))
		}
		switch operation.Op {
		case "create", "set", "merge":
			var value map[string]json.RawMessage
			if err := json.Unmarshal(operation.Value, &value); err != nil || value == nil {
				return invalidOperation(fmt.Sprintf("operation %d: value must be an object", index))
			}
		case "delete":
			if len(operation.Value) != 0 {
				return invalidOperation(fmt.Sprintf("operation %d: delete must not include value", index))
			}
		default:
			return invalidOperation(fmt.Sprintf("operation %d: unknown operation", index))
		}
	}
	return nil
}

func (app *application) patchProgress(w http.ResponseWriter, r *http.Request) {
	body, ok := readProgressBody(w, r)
	if !ok {
		return
	}
	var envelope struct {
		Operations []progressOperation `json:"operations"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_operations"})
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	stored, err := app.store.patch(r.Context(), envelope.Operations)
	if err != nil {
		var validation *patchError
		if errors.As(err, &validation) {
			response := map[string]any{"error": validation.code, "detail": validation.message}
			if validation.status == http.StatusConflict {
				if !stored.Found {
					stored.Payload = json.RawMessage(`{"items":{}}`)
				}
				response["payload"] = stored.Payload
				response["updatedAt"] = stored.UpdatedAt
			}
			writeJSON(w, validation.status, response)
		} else {
			app.storageError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "payload": stored.Payload, "updatedAt": stored.UpdatedAt,
	})
}

func (s *progressStore) patch(ctx context.Context, operations []progressOperation) (progress, error) {
	if err := validateOperations(operations); err != nil {
		return progress{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return progress{}, err
	}
	defer tx.Rollback()
	stored, err := scanProgress(tx.QueryRowContext(ctx,
		"SELECT payload, updated_at FROM progress WHERE id = 1"))
	if err != nil {
		return progress{}, err
	}
	stored, err = s.ensureBuiltinPoems(ctx, tx, stored, time.Now())
	if err != nil {
		return progress{}, err
	}
	state := make(map[string]json.RawMessage)
	if stored.Found {
		if err := json.Unmarshal(stored.Payload, &state); err != nil || state == nil {
			return progress{}, errors.New("stored progress must be an object")
		}
	}
	if _, exists := state["items"]; !exists {
		state["items"] = json.RawMessage(`{}`)
	}
	collections := make(map[string]map[string]json.RawMessage)
	loadCollection := func(collection string) (map[string]json.RawMessage, error) {
		entries, loaded := collections[collection]
		if !loaded {
			entries = make(map[string]json.RawMessage)
			if raw, exists := state[collection]; exists {
				if err := json.Unmarshal(raw, &entries); err != nil || entries == nil {
					return nil, fmt.Errorf("stored collection %q must be an object", collection)
				}
			}
			collections[collection] = entries
		}
		return entries, nil
	}
	for _, operation := range operations {
		entries, err := loadCollection(operation.Collection)
		if err != nil {
			return progress{}, err
		}
		if operation.Collection == "items" && s.isBuiltinPoem(operation.Key) {
			hidden, err := loadCollection("hiddenCourses")
			if err != nil {
				return progress{}, err
			}
			if operation.Op == "delete" {
				hidden[operation.Key], _ = json.Marshal(map[string]any{"removedAt": time.Now().UTC().Format(time.RFC3339Nano)})
			} else if _, removed := hidden[operation.Key]; removed {
				return stored, &patchError{http.StatusConflict, "entry_not_found", "poem was removed; restore it before reviewing"}
			}
		}
		switch operation.Op {
		case "create":
			// A second device can still show the pre-enrollment snapshot.
			// Its explicit add must never reset progress already recorded.
			if _, exists := entries[operation.Key]; !exists {
				entries[operation.Key] = operation.Value
			}
		case "delete":
			delete(entries, operation.Key)
			if operation.Collection == "items" {
				// Delete the latest server-side history too, including events
				// another device recorded after this client's last GET.
				activity, err := loadCollection("activity")
				if err != nil {
					return progress{}, err
				}
				for key, raw := range activity {
					var event struct {
						ID string `json:"id"`
					}
					if json.Unmarshal(raw, &event) == nil && event.ID == operation.Key {
						delete(activity, key)
					}
				}
			}
		case "set":
			entries[operation.Key] = operation.Value
		case "merge":
			existing, exists := entries[operation.Key]
			if !exists {
				return stored, &patchError{http.StatusConflict, "entry_not_found", "entry was removed or has not been created"}
			}
			var value, fields map[string]json.RawMessage
			if err := json.Unmarshal(existing, &value); err != nil || value == nil {
				return progress{}, errors.New("stored entry must be an object")
			}
			_ = json.Unmarshal(operation.Value, &fields) // validated above
			for key, field := range fields {
				value[key] = field
			}
			entries[operation.Key], err = json.Marshal(value)
			if err != nil {
				return progress{}, err
			}
		}
	}
	for collection, entries := range collections {
		state[collection], err = json.Marshal(entries)
		if err != nil {
			return progress{}, err
		}
	}
	updatedAt := time.Now().UnixMilli()
	if updatedAt <= stored.UpdatedAt && stored.UpdatedAt < 9_007_199_254_740_991 {
		updatedAt = stored.UpdatedAt + 1
	}
	state["updatedAt"], _ = json.Marshal(updatedAt)
	payload, err := json.Marshal(state)
	if err != nil {
		return progress{}, err
	}
	if len(payload) > maxProgressBytes {
		return progress{}, &patchError{http.StatusRequestEntityTooLarge, "payload too large", "stored progress exceeds 500 KB"}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO progress (id, payload, updated_at)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`, string(payload), updatedAt); err != nil {
		return progress{}, err
	}
	if err := tx.Commit(); err != nil {
		return progress{}, err
	}
	return progress{Payload: payload, UpdatedAt: updatedAt, Found: true}, nil
}
