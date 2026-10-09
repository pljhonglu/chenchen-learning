package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode"
)

// Parent confirmations remain readable/submittable for sessions started before
// automatic writing. New automatic results must represent a complete stroke quiz.
func validateAutomaticWriting(entry studyEntry) error {
	bad := func(message string) error {
		return gardenError(http.StatusBadRequest, "invalid_study_group", message)
	}
	var detail struct {
		Method           string `json:"method"`
		Engine           string `json:"engine"`
		Character        string `json:"character"`
		TotalStrokes     *int   `json:"totalStrokes"`
		CompletedStrokes *int   `json:"completedStrokes"`
		TotalMistakes    *int   `json:"totalMistakes"`
		HintsUsed        *int   `json:"hintsUsed"`
		OutlineShown     *bool  `json:"outlineShown"`
		AfterPractice    *bool  `json:"afterPractice"`
		Assisted         *bool  `json:"assisted"`
	}
	raw, err := json.Marshal(entry.Details)
	if err != nil || json.Unmarshal(raw, &detail) != nil || detail.Method != "stroke-quiz" || detail.Engine != "hanzi-writer-3.7.3" {
		return bad("汉字自动判断需要有效的逐笔校验结果")
	}
	characters := []rune(detail.Character)
	if len(characters) != 1 || !unicode.Is(unicode.Han, characters[0]) || strings.HasPrefix(entry.ID, "write-char-") && entry.ID != fmt.Sprintf("write-char-%x", characters[0]) {
		return bad("汉字自动判断与当前练习字不一致")
	}
	if detail.TotalStrokes == nil || *detail.TotalStrokes < 1 || *detail.TotalStrokes > 20 || detail.CompletedStrokes == nil || *detail.CompletedStrokes != *detail.TotalStrokes {
		return bad("请按笔顺完成这个字的全部笔画")
	}
	if detail.TotalMistakes == nil || *detail.TotalMistakes < 0 || detail.HintsUsed == nil || *detail.HintsUsed < 0 || detail.OutlineShown == nil || detail.AfterPractice == nil || detail.Assisted == nil {
		return bad("汉字自动判断缺少完整的重试与提示记录")
	}
	result := "supported"
	if *detail.TotalMistakes == 0 && *detail.HintsUsed == 0 && !*detail.OutlineShown && !*detail.AfterPractice && !*detail.Assisted {
		result = "independent"
	}
	if entry.Result != result {
		return bad("汉字确认结果与逐笔校验及提示记录不一致")
	}
	return nil
}

func validatePlannedWritingEntry(item studySessionItem, entry studyEntry) error {
	if item.Type == "write" && entry.Source == "automatic" && item.AfterPractice && entry.Details["afterPractice"] != true {
		return sessionConflict("已练习过的汉字需要保留练习后的确认状态")
	}
	return nil
}
