package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// China currently has a fixed UTC+8 calendar. Using a fixed zone also keeps
// minimal container images independent of a separately installed tz database.
var gardenLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type studyEntry struct {
	SchemaVersion int            `json:"schemaVersion"`
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Title         string         `json:"title"`
	Skill         string         `json:"skill"`
	Result        string         `json:"result"`
	Source        string         `json:"source"`
	Details       map[string]any `json:"details"`
	Day           string         `json:"day,omitempty"` // Never trusted; replaced at commit.
	At            any            `json:"at,omitempty"`  // Never trusted; replaced at commit.
}

type studyGroupRequest struct {
	ID      string       `json:"id"`
	Type    string       `json:"type"`
	Mode    string       `json:"mode"`
	Entries []studyEntry `json:"entries"`
}

type gardenGroup struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	Mode         string   `json:"mode"`
	Day          string   `json:"day"`
	At           string   `json:"at"`
	Count        int      `json:"count"`
	ContentIDs   []string `json:"contentIds"`
	WaterAwarded int      `json:"waterAwarded"`
	Signature    string   `json:"signature"`
}

type gardenWatering struct {
	ID        string `json:"id"`
	Day       string `json:"day"`
	At        string `json:"at"`
	Total     int    `json:"total"`
	Milestone int    `json:"milestone"`
}

type gardenGift struct {
	Milestone  int    `json:"milestone"`
	Day        string `json:"day"`
	At         string `json:"at"`
	WaterTotal int    `json:"waterTotal"`
}

type gardenLedger struct {
	Version   int                       `json:"version"`
	StartedAt string                    `json:"startedAt"`
	Groups    map[string]gardenGroup    `json:"groups"`
	Watering  map[string]gardenWatering `json:"watering"`
	Gifts     map[string]gardenGift     `json:"gifts"`
}

func gardenError(status int, code, message string) error {
	return &patchError{status, code, message}
}

func validGardenID(value string) bool {
	return value != "" && len(value) <= 200 && strings.TrimSpace(value) == value &&
		!strings.ContainsFunc(value, unicode.IsControl) && value != "__proto__" && value != "prototype" && value != "constructor"
}

func (s *progressStore) gardenNow() time.Time {
	if s.now != nil {
		return s.now().In(gardenLocation)
	}
	return time.Now().In(gardenLocation)
}

// Once complete groups exist, replacing progress through legacy PUT would
// separate the server-owned reward ledger from its activity and schedule data.
func hasSavedStudyGroups(previous progress) (bool, error) {
	if !previous.Found {
		return false, nil
	}
	var state struct {
		Garden struct {
			Groups map[string]json.RawMessage `json:"groups"`
		} `json:"garden"`
	}
	if err := json.Unmarshal(previous.Payload, &state); err != nil {
		return false, err
	}
	return len(state.Garden.Groups) > 0, nil
}

// Before the first completed group, legacy PUT remains compatible but cannot
// inject or erase a server-owned ledger. PATCH excludes garden entirely.
func retainGarden(payload json.RawMessage, previous progress) (json.RawMessage, error) {
	var incoming, old map[string]json.RawMessage
	if err := json.Unmarshal(payload, &incoming); err != nil || incoming == nil {
		return nil, errors.New("progress payload must be an object")
	}
	if previous.Found {
		if err := json.Unmarshal(previous.Payload, &old); err != nil {
			return nil, err
		}
	}
	if raw, exists := old["garden"]; exists {
		incoming["garden"] = raw
	} else if _, exists := incoming["garden"]; exists {
		delete(incoming, "garden")
	} else {
		return payload, nil
	}
	return json.Marshal(incoming)
}

func (app *application) gardenRequest(w http.ResponseWriter, r *http.Request) {
	body, ok := readProgressBody(w, r)
	if !ok {
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var group studyGroupRequest
	var water struct {
		ID string `json:"id"`
	}
	var target any = &group
	if r.URL.Path == "/api/garden/water" {
		target = &water
	}
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	var stored progress
	var err error
	if r.URL.Path == "/api/garden/water" {
		stored, err = app.store.waterGarden(r.Context(), water.ID)
	} else {
		stored, err = app.store.completeStudyGroup(r.Context(), group)
	}
	if err != nil {
		var validation *patchError
		if errors.As(err, &validation) {
			response := map[string]any{"ok": false, "error": validation.code, "message": validation.message}
			if stored.Found {
				response["payload"], response["updatedAt"] = stored.Payload, stored.UpdatedAt
			}
			writeJSON(w, validation.status, response)
		} else {
			app.storageError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "payload": stored.Payload, "updatedAt": stored.UpdatedAt})
}

func validateStudyGroup(group studyGroupRequest) (string, int, error) {
	bad := func(message string) (string, int, error) {
		return "", 0, gardenError(http.StatusBadRequest, "invalid_study_group", message)
	}
	if !validGardenID(group.ID) || (group.Mode != "learn" && group.Mode != "review") {
		return bad("需要有效的小组编号和学习方式")
	}
	sizes := map[string]int{"poem": 5, "pinyin": 10, "write": 5, "english": 5, "math": 1, "decomp": 1}
	skills := map[string]string{"poem": "poem-recitation", "pinyin": "pinyin-reading", "write": "hanzi-writing", "english": "english-listening", "math": "math-solving", "decomp": "math-solving"}
	count, exists := sizes[group.Type]
	if !exists || len(group.Entries) != count {
		return bad("请完成这一学科规定数量的小练习")
	}
	seen := make(map[string]bool)
	content := make([]string, 0, count)
	for _, entry := range group.Entries {
		if !validGardenID(entry.ID) || seen[entry.ID] || (entry.Type != "" && entry.Type != group.Type) ||
			(entry.SchemaVersion != 0 && entry.SchemaVersion != 2) || entry.Skill != skills[group.Type] ||
			strings.TrimSpace(entry.Title) == "" || len(entry.Title) > 2000 ||
			(entry.Result != "independent" && entry.Result != "supported" && entry.Result != "again") {
			return bad("小组中的内容、数量或确认结果不完整")
		}
		automatic := group.Type == "math" || group.Type == "decomp" || group.Type == "english"
		if automatic && entry.Source != "automatic" || !automatic && entry.Source != "parent" {
			return bad("请使用该学科实际的确认方式")
		}
		for _, flag := range []string{"afterPractice", "observedExposure", "exposureFirst", "assisted"} {
			if value, exists := entry.Details[flag]; exists {
				if _, ok := value.(bool); !ok {
					return bad("提示与示范状态必须是真实的确认值")
				}
			}
		}
		seen[entry.ID] = true
		content = append(content, entry.ID)
	}
	if group.Type == "math" || group.Type == "decomp" {
		entry := group.Entries[0]
		var detail struct {
			Total        int      `json:"total"`
			Correct      *int     `json:"correct"`
			QuestionKeys []string `json:"questionKeys"`
		}
		raw, err := json.Marshal(entry.Details)
		if err != nil || json.Unmarshal(raw, &detail) != nil || detail.Total != 10 || detail.Correct == nil || *detail.Correct < 0 || *detail.Correct > 10 || len(detail.QuestionKeys) != 10 {
			return bad("数学小组需要完整的十题首次作答结果")
		}
		result := "supported"
		if *detail.Correct == 10 {
			result = "independent"
		} else if *detail.Correct == 0 {
			result = "again"
		}
		if entry.Result != result {
			return bad("数学确认结果与首次答对题数不一致")
		}
		content = append([]string{}, detail.QuestionKeys...)
		for _, key := range content {
			if strings.TrimSpace(key) == "" || len(key) > 2000 {
				return bad("数学题目编号不完整")
			}
		}
		count = 10
	}
	sort.Strings(content)
	raw, _ := json.Marshal(struct {
		Type    string
		Content []string
	}{group.Type, content})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]), count, nil
}

// mutateGarden owns one SQLite write transaction, including quota checks.
// The callback returns false on an idempotent retry, preserving its timestamp.
func (s *progressStore) mutateGarden(ctx context.Context, change func(map[string]json.RawMessage, *gardenLedger, time.Time) (bool, error)) (progress, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return progress{}, err
	}
	defer tx.Rollback()
	stored, err := scanProgress(tx.QueryRowContext(ctx, "SELECT payload, updated_at FROM progress WHERE id = 1"))
	if err != nil {
		return progress{}, err
	}
	now := s.gardenNow()
	stored, err = s.ensureBuiltinPoems(ctx, tx, stored, now)
	if err != nil {
		return progress{}, err
	}
	state := make(map[string]json.RawMessage)
	if stored.Found {
		if err := json.Unmarshal(stored.Payload, &state); err != nil || state == nil {
			return progress{}, errors.New("stored progress must be an object")
		}
	}
	ledger := gardenLedger{Version: 1, StartedAt: now.Format(time.RFC3339Nano), Groups: map[string]gardenGroup{}, Watering: map[string]gardenWatering{}, Gifts: map[string]gardenGift{}}
	if raw, exists := state["garden"]; exists {
		if err := json.Unmarshal(raw, &ledger); err != nil || ledger.Version != 1 || ledger.Groups == nil || ledger.Watering == nil || ledger.Gifts == nil {
			return stored, errors.New("stored garden ledger is invalid")
		}
	}
	changed, err := change(state, &ledger, now)
	if err != nil {
		return stored, err
	}
	if !changed {
		return stored, tx.Commit()
	}
	state["garden"], err = json.Marshal(ledger)
	if err != nil {
		return stored, err
	}
	return saveGardenState(ctx, tx, state, stored, now)
}

func saveGardenState(ctx context.Context, tx *sql.Tx, state map[string]json.RawMessage, previous progress, now time.Time) (progress, error) {
	if _, exists := state["items"]; !exists {
		state["items"] = json.RawMessage(`{}`)
	}
	updatedAt := now.UnixMilli()
	if updatedAt <= previous.UpdatedAt && previous.UpdatedAt < 9_007_199_254_740_991 {
		updatedAt = previous.UpdatedAt + 1
	}
	state["updatedAt"], _ = json.Marshal(updatedAt)
	payload, err := json.Marshal(state)
	if err != nil {
		return previous, err
	}
	if len(payload) > maxStoredProgressBytes {
		return previous, gardenError(http.StatusRequestEntityTooLarge, "payload too large", "stored progress exceeds 32 MiB")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO progress (id,payload,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`, string(payload), updatedAt); err != nil {
		return previous, err
	}
	if err := tx.Commit(); err != nil {
		return previous, err
	}
	return progress{Payload: payload, UpdatedAt: updatedAt, Found: true}, nil
}

func gardenCollection(state map[string]json.RawMessage, key string) (map[string]json.RawMessage, error) {
	entries := make(map[string]json.RawMessage)
	if raw, exists := state[key]; exists {
		if err := json.Unmarshal(raw, &entries); err != nil || entries == nil {
			return nil, fmt.Errorf("stored %s is invalid", key)
		}
	}
	return entries, nil
}

func (s *progressStore) completeStudyGroup(ctx context.Context, group studyGroupRequest) (progress, error) {
	signature, count, err := validateStudyGroup(group)
	if err != nil {
		return progress{}, err
	}
	return s.mutateGarden(ctx, func(state map[string]json.RawMessage, ledger *gardenLedger, now time.Time) (bool, error) {
		if previous, exists := ledger.Groups[group.ID]; exists {
			if previous.Signature != signature || previous.Type != group.Type || previous.Mode != group.Mode {
				return false, gardenError(http.StatusConflict, "group_id_conflict", "这个小组编号已用于另一组练习，请返回首页")
			}
			return false, nil
		}
		items, err := gardenCollection(state, "items")
		if err != nil {
			return false, err
		}
		activity, err := gardenCollection(state, "activity")
		if err != nil {
			return false, err
		}
		hidden, err := gardenCollection(state, "hiddenCourses")
		if err != nil {
			return false, err
		}
		previousItems, previousActivity := copyEntries(items), copyEntries(activity)
		day, at := now.Format("2006-01-02"), now.Format(time.RFC3339Nano)
		operations := make([]progressOperation, 0, 2*len(group.Entries))
		contentIDs := make([]string, 0, len(group.Entries))
		for index, submitted := range group.Entries {
			entry := submitted
			var item map[string]json.RawMessage
			if raw, exists := items[entry.ID]; exists {
				if json.Unmarshal(raw, &item) != nil || item == nil {
					return false, errors.New("stored lesson must be an object")
				}
			}
			var learned bool
			_ = json.Unmarshal(item["learned"], &learned)
			if _, removed := hidden[entry.ID]; removed || group.Mode == "review" && !learned {
				return false, gardenError(http.StatusConflict, "entry_not_found", "有内容已移除或尚未加入复习，请返回首页重新开始")
			}
			if oldType := jsonString(item["type"]); oldType != "" && oldType != group.Type {
				return false, gardenError(http.StatusConflict, "content_type_conflict", "这项内容的学科已改变，请返回首页")
			}
			if item == nil {
				item = map[string]json.RawMessage{}
				for key, value := range map[string]any{"id": entry.ID, "type": group.Type, "title": entry.Title, "createdAt": at} {
					item[key], _ = json.Marshal(value)
				}
			}
			// Copy caller details: repeated submissions must not mutate the caller's request.
			detailRaw, _ := json.Marshal(entry.Details)
			entry.Details = map[string]any{}
			if string(detailRaw) != "null" {
				_ = json.Unmarshal(detailRaw, &entry.Details)
			}
			if next := jsonString(item["nextReview"]); next > day {
				entry.Details["afterPractice"] = true
			}
			entry.SchemaVersion, entry.Type, entry.Day, entry.At = 2, group.Type, day, at
			activityKey := fmt.Sprintf("study-group:%s:%d", group.ID, index)
			if _, exists := activity[activityKey]; exists {
				return false, gardenError(http.StatusConflict, "activity_id_conflict", "这一组的记录编号已存在，请返回首页")
			}
			activity[activityKey], _ = json.Marshal(entry)
			item["learned"] = json.RawMessage(`true`)
			item["updatedAt"], _ = json.Marshal(at)
			item["lastAssessment"], _ = json.Marshal(map[string]any{"result": entry.Result, "source": entry.Source, "skill": entry.Skill, "at": at})
			items[entry.ID], _ = json.Marshal(item)
			operations = append(operations, progressOperation{Op: "merge", Collection: "items", Key: entry.ID}, progressOperation{Op: "set", Collection: "activity", Key: activityKey})
			contentIDs = append(contentIDs, entry.ID)
		}
		if err := reconcileAssessmentSchedules(previousItems, previousActivity, items, activity, operations); err != nil {
			return false, err
		}
		// Reconciliation deliberately supports older same-day delivery. A new
		// group can never reschedule an item which is early at commit time.
		for _, id := range contentIDs {
			raw := previousItems[id]
			if raw == nil {
				continue
			}
			var old, current map[string]json.RawMessage
			if json.Unmarshal(raw, &old) != nil {
				continue
			}
			if jsonString(old["nextReview"]) <= day {
				continue
			}
			if json.Unmarshal(items[id], &current) != nil {
				continue
			}
			for _, key := range reviewFields {
				if value, exists := old[key]; exists {
					current[key] = value
				} else {
					delete(current, key)
				}
			}
			items[id], _ = json.Marshal(current)
		}
		// Old whole-subject tasks are replaced only after the first complete
		// concrete group, without deleting their historical practice records.
		legacyID, replacement := "", ""
		if group.Type == "pinyin" {
			legacyID, replacement = "pinyin-basic", "individual-pinyin"
		} else if group.Type == "write" {
			legacyID, replacement = "write-basic", "individual-characters"
		}
		if raw := items[legacyID]; legacyID != "" && raw != nil {
			var legacy map[string]json.RawMessage
			if json.Unmarshal(raw, &legacy) != nil || legacy == nil {
				return false, errors.New("stored legacy lesson is invalid")
			}
			legacy["learned"] = json.RawMessage(`false`)
			legacy["replacedBy"], _ = json.Marshal(replacement)
			legacy["updatedAt"], _ = json.Marshal(at)
			items[legacyID], _ = json.Marshal(legacy)
		}
		awarded, repeated := 0, false
		for _, previous := range ledger.Groups {
			if previous.Day == day {
				awarded += previous.WaterAwarded
				repeated = repeated || previous.Signature == signature
			}
		}
		water := 0
		if awarded < 3 && !repeated {
			water = 1
		}
		ledger.Groups[group.ID] = gardenGroup{ID: group.ID, Type: group.Type, Mode: group.Mode, Day: day, At: at, Count: count, ContentIDs: contentIDs, WaterAwarded: water, Signature: signature}
		state["items"], _ = json.Marshal(items)
		state["activity"], _ = json.Marshal(activity)
		return true, nil
	})
}

func (s *progressStore) waterGarden(ctx context.Context, id string) (progress, error) {
	if !validGardenID(id) {
		return progress{}, gardenError(http.StatusBadRequest, "invalid_watering", "需要有效的浇水编号")
	}
	return s.mutateGarden(ctx, func(state map[string]json.RawMessage, ledger *gardenLedger, now time.Time) (bool, error) {
		if _, exists := ledger.Watering[id]; exists {
			return false, nil
		}
		day, at := now.Format("2006-01-02"), now.Format(time.RFC3339Nano)
		hasGroup, earned, todayWatering := false, 0, 0
		for _, group := range ledger.Groups {
			hasGroup = hasGroup || group.Day == day
			earned += group.WaterAwarded
		}
		for _, water := range ledger.Watering {
			if water.Day == day {
				todayWatering++
			}
		}
		if !hasGroup {
			return false, gardenError(http.StatusConflict, "study_group_required", "今天完成一组学习后，就可以浇水啦")
		}
		if todayWatering >= 3 {
			return false, gardenError(http.StatusTooManyRequests, "daily_watering_limit", "小树今天喝好啦")
		}
		if earned <= len(ledger.Watering) {
			return false, gardenError(http.StatusConflict, "water_required", "水壶里还没有水滴")
		}
		total, milestone := len(ledger.Watering)+1, 0
		if total%12 == 0 {
			milestone = total / 12
			ledger.Gifts[strconv.Itoa(milestone)] = gardenGift{Milestone: milestone, Day: day, At: at, WaterTotal: total}
		}
		ledger.Watering[id] = gardenWatering{ID: id, Day: day, At: at, Total: total, Milestone: milestone}
		return true, nil
	})
}
