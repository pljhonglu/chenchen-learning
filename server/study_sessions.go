package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"time"
)

type studySessionItem struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Title         string `json:"title"`
	Phase         string `json:"phase,omitempty"`
	Source        string `json:"source,omitempty"`
	AfterPractice bool   `json:"afterPractice,omitempty"`
}

type studySessionRequest struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Mode     string             `json:"mode"`
	Items    []studySessionItem `json:"items"`
	Entries  []studyEntry       `json:"entries"`
	Progress map[string]any     `json:"progress,omitempty"`
}

type studySession struct {
	studySessionRequest
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func sessionConflict(message string) error {
	return gardenError(http.StatusConflict, "study_session_conflict", message)
}

func cleanStudyEntry(entry studyEntry, kind string) studyEntry {
	entry.SchemaVersion, entry.Type, entry.Day, entry.At = 2, kind, "", nil
	raw, _ := json.Marshal(entry.Details)
	entry.Details = map[string]any{}
	if string(raw) != "null" {
		_ = json.Unmarshal(raw, &entry.Details)
	}
	return entry
}

func sameStudyEntry(a, b studyEntry, kind string) bool {
	return reflect.DeepEqual(cleanStudyEntry(a, kind), cleanStudyEntry(b, kind))
}

func validateSession(request *studySessionRequest) error {
	sizes := map[string]int{"poem": 5, "write": 5, "english": 5, "pinyin": 10, "math": 1, "decomp": 1}
	size, exists := sizes[request.Type]
	if !exists || !validGardenID(request.ID) || (request.Mode != "review" && request.Mode != "learn") || len(request.Items) < 1 || len(request.Items) > size || len(request.Entries) > len(request.Items) {
		return gardenError(http.StatusBadRequest, "invalid_study_session", "学习计划或已完成数量不正确")
	}
	seen := map[string]bool{}
	for index := range request.Items {
		item := &request.Items[index]
		if item.Type == "" {
			item.Type = request.Type
		}
		if item.Phase == "" {
			item.Phase = request.Mode
		}
		if !validGardenID(item.ID) || item.Type != request.Type || item.Title == "" || len(item.Title) > 2000 || seen[item.ID] || (item.Phase != "review" && item.Phase != "learn") || len(item.Source) > 100 {
			return gardenError(http.StatusBadRequest, "invalid_study_session", "学习计划中存在不合法或重复内容")
		}
		seen[item.ID] = true
	}
	if len(request.Entries) > 0 {
		if _, _, err := validateStudyGroup(studyGroupRequest{ID: request.ID, Type: request.Type, Mode: request.Mode, Entries: request.Entries}); err != nil {
			return err
		}
		for index, entry := range request.Entries {
			if entry.ID != request.Items[index].ID {
				return sessionConflict("已完成内容必须按原计划顺序保存")
			}
			if err := validatePlannedWritingEntry(request.Items[index], entry); err != nil {
				return err
			}
		}
	}
	raw, _ := json.Marshal(request.Progress)
	if len(raw) > 128*1024 {
		return gardenError(http.StatusRequestEntityTooLarge, "invalid_study_session", "学习中的临时进度过大")
	}
	return nil
}

func validateSessionContents(state map[string]json.RawMessage, request studySessionRequest) error {
	items, err := gardenCollection(state, "items")
	if err != nil {
		return err
	}
	hidden, err := gardenCollection(state, "hiddenCourses")
	if err != nil {
		return err
	}
	for _, planned := range request.Items {
		if _, removed := hidden[planned.ID]; removed {
			return sessionConflict("计划中的内容已移除，请放弃旧计划后重新开始")
		}
		var item map[string]json.RawMessage
		if raw, exists := items[planned.ID]; exists {
			if json.Unmarshal(raw, &item) != nil {
				return errors.New("stored lesson is invalid")
			}
			if kind := jsonString(item["type"]); kind != "" && kind != request.Type {
				return sessionConflict("计划中的学科已改变")
			}
		}
		if planned.Phase == "review" {
			if request.Type == "poem" {
				if item == nil {
					return sessionConflict("计划中的古诗已不存在")
				}
			} else if string(item["learned"]) != "true" {
				return sessionConflict("计划中的内容已移除或尚未加入复习")
			}
		}
	}
	return nil
}

func (app *application) studySessionRequest(w http.ResponseWriter, r *http.Request) {
	var stored progress
	var err error
	if r.Method == http.MethodDelete {
		stored, err = app.store.deleteStudySession(r.Context(), r.URL.Query().Get("id"))
	} else {
		body, ok := readProgressBody(w, r)
		if !ok {
			return
		}
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		var request studySessionRequest
		if decoder.Decode(&request) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_study_session"})
			return
		}
		if decodeErr := decoder.Decode(new(any)); !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		stored, err = app.store.saveStudySession(r.Context(), request)
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

func (s *progressStore) saveStudySession(ctx context.Context, request studySessionRequest) (progress, error) {
	if err := validateSession(&request); err != nil {
		return progress{}, err
	}
	return s.mutateGarden(ctx, func(state map[string]json.RawMessage, ledger *gardenLedger, now time.Time) (bool, error) {
		if previous, exists := ledger.Groups[request.ID]; exists {
			if previous.Type != request.Type || previous.Mode != request.Mode {
				return false, sessionConflict("这个编号已用于另一组学习")
			}
			return false, nil
		}
		if err := validateSessionContents(state, request); err != nil {
			return false, err
		}
		if err := s.validateWritingPlanAssets(state, request); err != nil {
			return false, err
		}
		sessions, err := gardenCollection(state, "studySessions")
		if err != nil {
			return false, err
		}
		var previous studySession
		if raw, exists := sessions[request.ID]; exists {
			if json.Unmarshal(raw, &previous) != nil {
				return false, errors.New("stored study session is invalid")
			}
			if previous.Type != request.Type || previous.Mode != request.Mode || !reflect.DeepEqual(previous.Items, request.Items) || len(request.Entries) < len(previous.Entries) {
				return false, sessionConflict("学习计划已更新，请恢复服务器中的进度")
			}
			for index, entry := range previous.Entries {
				if !sameStudyEntry(entry, request.Entries[index], request.Type) {
					return false, sessionConflict("已经保存的首次结果不能改写")
				}
			}
		} else {
			for _, raw := range sessions {
				var active studySession
				if json.Unmarshal(raw, &active) != nil {
					return false, errors.New("stored study session is invalid")
				}
				if active.Type == request.Type {
					return false, gardenError(http.StatusConflict, "study_session_exists", "这个学科已有未完成计划，请先继续或放弃")
				}
			}
		}
		at, day := now.Format(time.RFC3339Nano), now.Format("2006-01-02")
		entries := make([]studyEntry, 0, len(request.Entries))
		for index, entry := range request.Entries {
			if index < len(previous.Entries) {
				entries = append(entries, previous.Entries[index])
				continue
			}
			entry = cleanStudyEntry(entry, request.Type)
			entry.Day, entry.At = day, at
			entries = append(entries, entry)
		}
		request.Entries = entries
		request.Progress, err = mergeSessionProgress(previous.Progress, request.Progress, request.Type, now)
		if err != nil {
			return false, err
		}
		if previous.ID != "" && reflect.DeepEqual(previous.studySessionRequest, request) {
			return false, nil
		}
		created := previous.CreatedAt
		if created == "" {
			created = at
		}
		session := studySession{studySessionRequest: request, CreatedAt: created, UpdatedAt: at}
		sessions[request.ID], _ = json.Marshal(session)
		state["studySessions"], _ = json.Marshal(sessions)
		return true, nil
	})
}

func (s *progressStore) deleteStudySession(ctx context.Context, id string) (progress, error) {
	if !validGardenID(id) {
		return progress{}, gardenError(http.StatusBadRequest, "invalid_study_session", "需要有效的学习计划编号")
	}
	return s.mutateGarden(ctx, func(state map[string]json.RawMessage, _ *gardenLedger, _ time.Time) (bool, error) {
		sessions, err := gardenCollection(state, "studySessions")
		if err != nil {
			return false, err
		}
		if _, exists := sessions[id]; !exists {
			return false, nil
		}
		delete(sessions, id)
		state["studySessions"], _ = json.Marshal(sessions)
		return true, nil
	})
}

// A completed group reuses the server's first saved answer time. Reward dates
// still describe completion, so an overnight session cannot claim yesterday's quota.
func finalizeStudySession(group studyGroupRequest, state, sessions map[string]json.RawMessage, now time.Time) (studyGroupRequest, error) {
	at, day := now.Format(time.RFC3339Nano), now.Format("2006-01-02")
	entries := make([]studyEntry, len(group.Entries))
	for index, entry := range group.Entries {
		entries[index] = cleanStudyEntry(entry, group.Type)
		entries[index].Day, entries[index].At = day, at
	}
	group.Entries = entries
	raw, exists := sessions[group.ID]
	if !exists {
		if group.Type == "math" || group.Type == "decomp" {
			if err := restoreMathAnswerTimes(group.Entries[0].Details, nil, now); err != nil {
				return group, err
			}
		}
		return group, nil
	}
	var session studySession
	if json.Unmarshal(raw, &session) != nil {
		return group, errors.New("stored study session is invalid")
	}
	if err := validateSessionContents(state, session.studySessionRequest); err != nil {
		return group, err
	}
	if session.Type != group.Type || session.Mode != group.Mode || len(session.Items) != len(group.Entries) || len(session.Entries) > len(group.Entries) {
		return group, sessionConflict("完成结果与原学习计划不一致")
	}
	for index, entry := range group.Entries {
		if entry.ID != session.Items[index].ID {
			return group, sessionConflict("完成内容与原学习计划不一致")
		}
		if err := validatePlannedWritingEntry(session.Items[index], entry); err != nil {
			return group, err
		}
		if index < len(session.Entries) {
			saved := session.Entries[index]
			if !sameStudyEntry(saved, entry, group.Type) {
				return group, sessionConflict("已经保存的首次结果不能改写")
			}
			if saved.Day > day {
				return group, sessionConflict("学习结果时间超出服务器当前日期")
			}
			group.Entries[index] = saved
		}
	}
	if group.Type == "math" || group.Type == "decomp" {
		if err := restoreMathAnswerTimes(group.Entries[0].Details, session.Progress, now); err != nil {
			return group, err
		}
	}
	return group, nil
}

func sessionPractice(progress map[string]any) map[string]any {
	if practice, ok := progress["practice"].(map[string]any); ok {
		return practice
	}
	return progress
}

func mergeSessionProgress(old, incoming map[string]any, kind string, now time.Time) (map[string]any, error) {
	if incoming == nil {
		return old, nil
	}
	// JSON round trip avoids mutating a caller while preserving module-specific data.
	raw, _ := json.Marshal(incoming)
	var next map[string]any
	_ = json.Unmarshal(raw, &next)
	if kind != "math" && kind != "decomp" {
		return next, nil
	}
	before, after := sessionPractice(old), sessionPractice(next)
	if questions, exists := before["questions"]; exists && !reflect.DeepEqual(questions, after["questions"]) {
		return nil, sessionConflict("已经开始的题目计划不能改写")
	}
	questions, _ := after["questions"].([]any)
	questionKeys := map[string]bool{}
	if _, exists := after["questions"]; exists {
		if len(questions) < 1 || len(questions) > 10 {
			return nil, sessionConflict("数学计划需要一到十道题")
		}
		for _, raw := range questions {
			question, ok := raw.(map[string]any)
			key, _ := question["key"].(string)
			knowledge, _ := question["knowledgeId"].(string)
			if !ok || !validMathKnowledge(kind, key, knowledge) || questionKeys[key] {
				return nil, sessionConflict("数学题目计划不合法")
			}
			questionKeys[key] = true
		}
	}
	previous, _ := before["questionResults"].([]any)
	results, _ := after["questionResults"].([]any)
	if len(results) < len(previous) || len(results) > 10 || len(questions) > 0 && len(results) > len(questions) {
		return nil, sessionConflict("数学首次作答结果不能减少或超过十题")
	}
	seen := map[string]bool{}
	for index, raw := range results {
		answer, ok := raw.(map[string]any)
		if !ok {
			return nil, sessionConflict("数学作答结果格式不正确")
		}
		key, _ := answer["key"].(string)
		knowledge, _ := answer["knowledgeId"].(string)
		_, correct := answer["correct"].(bool)
		if !correct || !validMathKnowledge(kind, key, knowledge) || seen[key] {
			return nil, sessionConflict("数学题目或知识点不正确")
		}
		seen[key] = true
		if len(questions) > 0 {
			question := questions[index].(map[string]any)
			if question["key"] != key || question["knowledgeId"] != knowledge {
				return nil, sessionConflict("数学作答顺序与原题目计划不一致")
			}
		}
		if supplied, exists := answer["answer"]; exists {
			value, ok := supplied.(float64)
			if !ok || value < 0 || value > 10 || value != float64(int(value)) || answer["correct"] != (int(value) == mathAnswerForKey(kind, key)) {
				return nil, sessionConflict("数学首答与对错判断不一致")
			}
		}
		delete(answer, "day")
		delete(answer, "at")
		if index < len(previous) {
			previousAnswer, ok := previous[index].(map[string]any)
			if !ok {
				return nil, errors.New("stored math answer is invalid")
			}
			comparable := map[string]any{}
			for field, value := range previousAnswer {
				if field != "day" && field != "at" {
					comparable[field] = value
				}
			}
			if !reflect.DeepEqual(comparable, answer) {
				return nil, sessionConflict("已经保存的数学首次答案不能改写")
			}
			results[index] = previousAnswer
		} else {
			answer["day"], answer["at"] = now.Format("2006-01-02"), now.Format(time.RFC3339Nano)
		}
	}
	after["questionResults"] = results
	return next, nil
}

func restoreMathAnswerTimes(details, progress map[string]any, now time.Time) error {
	practice := sessionPractice(progress)
	saved, _ := practice["questionResults"].([]any)
	questions, _ := practice["questions"].([]any)
	results, exists := details["questionResults"]
	if !exists {
		if len(saved) > 0 {
			return sessionConflict("数学完整结果缺少已保存的首次答案")
		}
		return nil
	}
	raw, _ := json.Marshal(results)
	var incoming []map[string]any
	_ = json.Unmarshal(raw, &incoming)
	if len(incoming) < len(saved) || len(questions) > 0 && len(incoming) != len(questions) {
		return sessionConflict("数学完整结果缺少已保存的首次答案")
	}
	for index, answer := range incoming {
		if len(questions) > 0 {
			question, ok := questions[index].(map[string]any)
			if !ok || question["key"] != answer["key"] || question["knowledgeId"] != answer["knowledgeId"] {
				return sessionConflict("数学完整结果与原题目计划不一致")
			}
		}
		answer["day"], answer["at"] = now.Format("2006-01-02"), now.Format(time.RFC3339Nano)
		if index >= len(saved) {
			continue
		}
		previous, ok := saved[index].(map[string]any)
		if !ok {
			return errors.New("stored math answer is invalid")
		}
		for _, field := range []string{"key", "knowledgeId", "correct"} {
			if !reflect.DeepEqual(answer[field], previous[field]) {
				return sessionConflict("数学完整结果改写了首次答案")
			}
		}
		savedDay, _ := previous["day"].(string)
		if savedDay > now.Format("2006-01-02") {
			return sessionConflict("数学作答时间超出服务器当前日期")
		}
		answer["day"], answer["at"] = savedDay, previous["at"]
	}
	details["questionResults"] = incoming
	return nil
}
