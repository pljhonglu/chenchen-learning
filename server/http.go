package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"
)

const maxProgressBytes = 5 * 1024 * 1024
const maxProgressRequestBytes = maxProgressBytes + 64*1024 // JSON envelope and operation names.

type application struct {
	store  *progressStore
	public *os.Root
	logger *slog.Logger
}

func (app *application) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		app.serveStatic(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, PATCH, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Add("Vary", "Origin")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	switch r.URL.Path {
	case "/api/health":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET, OPTIONS")
			return
		}
		if err := app.store.db.PingContext(ctx); err != nil {
			app.logger.Error("database health check failed", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "storage_unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "service": "chenchen-learning", "storage": "sqlite", "db": app.store.path,
		})
	case "/api/progress":
		switch r.Method {
		case http.MethodGet:
			app.getProgress(w, ctx)
		case http.MethodPut:
			app.putProgress(w, r.WithContext(ctx))
		case http.MethodPatch:
			app.patchProgress(w, r.WithContext(ctx))
		default:
			methodNotAllowed(w, "GET, PUT, PATCH, OPTIONS")
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	}
}

func (app *application) getProgress(w http.ResponseWriter, ctx context.Context) {
	stored, err := app.store.get(ctx)
	if err != nil {
		app.storageError(w, err)
		return
	}
	if !stored.Found {
		writeJSON(w, http.StatusOK, map[string]any{"found": false, "payload": nil, "updatedAt": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"found": true, "payload": stored.Payload, "updatedAt": stored.UpdatedAt,
	})
}

func readProgressBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "application/json required"})
			return nil, false
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxProgressRequestBytes)
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "payload too large"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		}
		return nil, false
	}
	return body, true
}

func (app *application) putProgress(w http.ResponseWriter, r *http.Request) {
	body, ok := readProgressBody(w, r)
	if !ok {
		return
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil || envelope == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	payload := envelope["payload"]
	if len(payload) > maxProgressBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "payload too large"})
		return
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil || object == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payload.items required"})
		return
	}
	var items map[string]json.RawMessage
	if err := json.Unmarshal(object["items"], &items); err != nil || items == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payload.items required"})
		return
	}
	var clientUpdatedAt int64
	if raw := envelope["clientUpdatedAt"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &clientUpdatedAt); err != nil || clientUpdatedAt > 9_007_199_254_740_991 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_client_updated_at"})
			return
		}
	}
	stored, kept, err := app.store.put(r.Context(), payload, clientUpdatedAt)
	if err != nil {
		var limit *patchError
		if errors.As(err, &limit) {
			writeJSON(w, limit.status, map[string]string{"error": limit.code})
			return
		}
		app.storageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "merged": kept == "client", "kept": kept,
		"payload": stored.Payload, "updatedAt": stored.UpdatedAt,
	})
}

func (app *application) storageError(w http.ResponseWriter, err error) {
	app.logger.Error("progress storage failed", "error", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage_error"})
}

func (app *application) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	// No hidden files, directory listings, or alternate path separators.
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") || strings.Contains(part, "\\") || strings.ContainsRune(part, '\x00') {
			http.NotFound(w, r)
			return
		}
	}
	if name == "" || strings.HasSuffix(name, "/") {
		name += "index.html"
	}
	// os.Root keeps file opens beneath public, including symlinks and races.
	file, err := app.public.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	// Revalidate assets after an image upgrade; browser cache remains usable.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
