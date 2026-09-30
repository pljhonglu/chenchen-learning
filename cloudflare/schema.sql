-- Chenchen learning progress sync (one row per sync_code)
CREATE TABLE IF NOT EXISTS progress (
  sync_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_progress_updated_at ON progress(updated_at);
