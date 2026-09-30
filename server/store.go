package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Keep the original Python service's schema so existing /data volumes work
// without a migration or an export/import step.
const progressSchema = `CREATE TABLE IF NOT EXISTS progress (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	payload TEXT NOT NULL,
	updated_at INTEGER NOT NULL
)`

type progressStore struct {
	db   *sql.DB
	path string
}

type progress struct {
	Payload   json.RawMessage
	UpdatedAt int64
	Found     bool
}

func openStore(dataDir string) (*progressStore, error) {
	if err := os.MkdirAll(dataDir, 0750); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	dbPath, err := filepath.Abs(filepath.Join(dataDir, "progress.db"))
	if err != nil {
		return nil, err
	}
	dsn := &url.URL{Scheme: "file", Path: filepath.ToSlash(dbPath)}
	query := dsn.Query()
	query.Add("_pragma", "busy_timeout(5000)")
	// PATCH reads and edits JSON in one transaction. Acquire the write lock
	// before that read, including when two server processes share the volume.
	query.Set("_txlock", "immediate")
	dsn.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, fmt.Errorf("open progress database: %w", err)
	}
	// One connection serializes local writes; the conditional UPSERT also
	// protects the last-write-wins rule when another process opens this DB.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, progressSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize progress database: %w", err)
	}
	return &progressStore{db: db, path: dbPath}, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanProgress(row rowScanner) (progress, error) {
	var value progress
	var payload string
	err := row.Scan(&payload, &value.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	if !json.Valid([]byte(payload)) {
		return value, errors.New("stored progress contains invalid JSON")
	}
	value.Payload = json.RawMessage(payload)
	value.Found = true
	return value, nil
}

func (s *progressStore) get(ctx context.Context) (progress, error) {
	return scanProgress(s.db.QueryRowContext(ctx,
		"SELECT payload, updated_at FROM progress WHERE id = 1"))
}

func (s *progressStore) put(ctx context.Context, payload json.RawMessage, updatedAt int64) (progress, string, error) {
	if updatedAt <= 0 {
		updatedAt = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return progress{}, "", err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO progress (id, payload, updated_at)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			payload = excluded.payload,
			updated_at = excluded.updated_at
		WHERE excluded.updated_at >= progress.updated_at`, string(payload), updatedAt)
	if err != nil {
		return progress{}, "", err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return progress{}, "", err
	}
	stored, err := scanProgress(tx.QueryRowContext(ctx,
		"SELECT payload, updated_at FROM progress WHERE id = 1"))
	if err != nil {
		return progress{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return progress{}, "", err
	}
	kept := "client"
	if changed == 0 {
		kept = "server"
	}
	return stored, kept, nil
}
