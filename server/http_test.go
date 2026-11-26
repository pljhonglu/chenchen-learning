package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testApp(t *testing.T) *application {
	t.Helper()
	store, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.db.Close() })
	dir := t.TempDir()
	for name, contents := range map[string]string{
		"index.html": "<!doctype html><title>辰辰</title>",
		"app.js":     "console.log('ready')",
		".secret":    "secret",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "private.txt")
	if err := os.WriteFile(outside, []byte("outside-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	public, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { public.Close() })
	return &application{store: store, public: public, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func request(app *application, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	return res
}

func TestProgressAPIContract(t *testing.T) {
	app := testApp(t)
	empty := request(app, http.MethodGet, "/api/progress", "")
	if empty.Code != 200 || strings.TrimSpace(empty.Body.String()) != `{"found":false,"payload":null,"updatedAt":null}` {
		t.Fatalf("empty progress: %d %s", empty.Code, empty.Body.String())
	}
	health := request(app, http.MethodGet, "/api/health", "")
	if health.Code != 200 || !strings.Contains(health.Body.String(), `"storage":"sqlite"`) {
		t.Fatalf("health: %d %s", health.Code, health.Body.String())
	}
	put := request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{"课文":{"level":2}},"extra":{"stars":7}},"clientUpdatedAt":12345}`)
	var response struct {
		OK        bool            `json:"ok"`
		Merged    bool            `json:"merged"`
		Kept      string          `json:"kept"`
		Payload   json.RawMessage `json:"payload"`
		UpdatedAt int64           `json:"updatedAt"`
	}
	if err := json.Unmarshal(put.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if put.Code != 200 || !response.OK || !response.Merged || response.Kept != "client" || response.UpdatedAt != 12345 {
		t.Fatalf("put progress: %d %s", put.Code, put.Body.String())
	}
	// Unknown payload fields must survive so existing/future clients can sync.
	get := request(app, http.MethodGet, "/api/progress?source=test", "")
	if get.Code != 200 || !strings.Contains(get.Body.String(), `"extra":{"stars":7}`) {
		t.Fatalf("get progress: %d %s", get.Code, get.Body.String())
	}
	stale := request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{}},"clientUpdatedAt":1}`)
	if stale.Code != 200 || !strings.Contains(stale.Body.String(), `"kept":"server"`) || !strings.Contains(stale.Body.String(), `"merged":false`) {
		t.Fatalf("stale progress: %d %s", stale.Code, stale.Body.String())
	}
	if get.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("API responses must not be cached")
	}
}

func TestInvalidProgressRequestsDoNotOverwriteData(t *testing.T) {
	app := testApp(t)
	request(app, http.MethodPut, "/api/progress", `{"payload":{"items":{"keep":{}}},"clientUpdatedAt":10}`)
	for _, body := range []string{
		"", "null", "[]", "false", `{"payload":`, `{} {}`,
		`{"payload":[]}`, `{"payload":null}`, `{"payload":{}}`,
		`{"payload":{"items":null}}`, `{"payload":{"items":[]}}`,
		`{"payload":{"items":{}},"clientUpdatedAt":"bad"}`,
		`{"payload":{"items":{}},"clientUpdatedAt":1.5}`,
		`{"payload":{"items":{}},"clientUpdatedAt":9223372036854775808}`,
		`{"payload":{"items":{}},"clientUpdatedAt":9007199254740992}`,
	} {
		t.Run(body, func(t *testing.T) {
			res := request(app, http.MethodPut, "/api/progress", body)
			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d %s", res.Code, res.Body.String())
			}
		})
	}
	res := request(app, http.MethodGet, "/api/progress", "")
	if !strings.Contains(res.Body.String(), `"keep":{}`) || !strings.Contains(res.Body.String(), `"updatedAt":10`) {
		t.Fatalf("invalid request changed data: %s", res.Body.String())
	}
}

func TestRequestLimitIncludesChunkedBodiesAndWhitespace(t *testing.T) {
	app := testApp(t)
	body := `{"payload":{"items":{}}}` + strings.Repeat(" ", maxProgressRequestBytes)
	req := httptest.NewRequest(http.MethodPut, "/api/progress", strings.NewReader(body))
	req.ContentLength = -1
	req.TransferEncoding = []string{"chunked"}
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d %s", res.Code, res.Body.String())
	}
}

func TestStaticFilesCannotEscapePublic(t *testing.T) {
	app := testApp(t)
	for _, path := range []string{"/", "/app.js"} {
		res := request(app, http.MethodGet, path, "")
		if res.Code != http.StatusOK || res.Body.Len() == 0 {
			t.Errorf("%s: status=%d, body=%q", path, res.Code, res.Body.String())
		}
	}
	for _, path := range []string{
		"/.secret", "/%2esecret", "/../private.txt", "/%2e%2e/private.txt",
		"/escape.txt", "/empty", "/empty/", "/missing", "/%5c..%5cprivate.txt",
	} {
		res := request(app, http.MethodGet, path, "")
		if res.Code != http.StatusNotFound || strings.Contains(res.Body.String(), "secret") {
			t.Errorf("%s escaped static root: status=%d, body=%q", path, res.Code, res.Body.String())
		}
	}
	head := request(app, http.MethodHead, "/app.js", "")
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("HEAD: status=%d, body=%q", head.Code, head.Body.String())
	}
}

func TestMethodsPreflightAndStorageErrors(t *testing.T) {
	app := testApp(t)
	for _, tc := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodDelete, "/api/progress", 405},
		{http.MethodPut, "/api/health", 405},
		{http.MethodGet, "/api/unknown", 404},
		{http.MethodPut, "/app.js", 405},
		{http.MethodOptions, "/api/progress", 204},
	} {
		res := request(app, tc.method, tc.path, "")
		if res.Code != tc.status {
			t.Errorf("%s %s: got %d, want %d", tc.method, tc.path, res.Code, tc.status)
		}
	}
	req := httptest.NewRequest(http.MethodOptions, "/api/progress", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	preflight := httptest.NewRecorder()
	app.ServeHTTP(preflight, req)
	if preflight.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatal("cross-origin API compatibility lost")
	}
	req = httptest.NewRequest(http.MethodPut, "/api/progress", strings.NewReader(`{"payload":{"items":{}}}`))
	req.Header.Set("Content-Type", "text/plain")
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	if res.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("unexpected media-type result: %d", res.Code)
	}
	app.store.db.Close()
	failed := request(app, http.MethodGet, "/api/progress", "")
	if failed.Code != 500 || strings.Contains(failed.Body.String(), app.store.path) {
		t.Fatalf("storage failure: %d %s", failed.Code, failed.Body.String())
	}
	health := request(app, http.MethodGet, "/api/health", "")
	if health.Code != http.StatusServiceUnavailable {
		t.Fatalf("closed database reported healthy: %d", health.Code)
	}
}
