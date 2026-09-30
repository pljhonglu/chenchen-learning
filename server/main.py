#!/usr/bin/env python3
"""Chenchen learning — self-hosted static + SQLite progress API."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "progress.db"
PUBLIC_DIR = Path(os.environ.get("PUBLIC_DIR", str(Path(__file__).resolve().parents[1] / "public")))

_db_lock = threading.Lock()


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS progress (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              payload TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.commit()


def get_progress() -> tuple[dict | None, int | None]:
    with _db_lock:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                "SELECT payload, updated_at FROM progress WHERE id = 1"
            ).fetchone()
    if not row:
        return None, None
    return json.loads(row[0]), int(row[1])


def put_progress(payload: dict, client_updated_at: int) -> tuple[dict, int, str]:
    """LWW by updated_at. Returns (payload, updated_at, kept)."""
    write_at = int(client_updated_at) if client_updated_at else 0
    if write_at <= 0:
        import time

        write_at = int(time.time() * 1000)

    with _db_lock:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                "SELECT payload, updated_at FROM progress WHERE id = 1"
            ).fetchone()
            if row and int(row[1]) > write_at:
                return json.loads(row[0]), int(row[1]), "server"
            payload_str = json.dumps(payload, ensure_ascii=False)
            conn.execute(
                """
                INSERT INTO progress (id, payload, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  payload = excluded.payload,
                  updated_at = excluded.updated_at
                WHERE excluded.updated_at >= progress.updated_at
                """,
                (payload_str, write_at),
            )
            conn.commit()
            row = conn.execute(
                "SELECT payload, updated_at FROM progress WHERE id = 1"
            ).fetchone()
    return json.loads(row[0]), int(row[1]), "client"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _cors(self) -> None:
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")

    def _json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json(
                200,
                {
                    "ok": True,
                    "service": "chenchen-learning",
                    "storage": "sqlite",
                    "db": str(DB_PATH),
                },
            )
            return
        if path == "/api/progress":
            payload, updated_at = get_progress()
            if payload is None:
                self._json(200, {"found": False, "payload": None, "updatedAt": None})
            else:
                self._json(
                    200,
                    {"found": True, "payload": payload, "updatedAt": updated_at},
                )
            return
        return super().do_GET()

    def do_PUT(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/progress":
            self._json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 500_000:
            self._json(400, {"error": "payload too large"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "invalid_json"})
            return
        payload = body.get("payload")
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), dict):
            self._json(400, {"error": "payload.items required"})
            return
        client_updated_at = int(body.get("clientUpdatedAt") or 0)
        stored, updated_at, kept = put_progress(payload, client_updated_at)
        self._json(
            200,
            {
                "ok": True,
                "merged": kept == "client",
                "kept": kept,
                "payload": stored,
                "updatedAt": updated_at,
            },
        )


def main() -> None:
    if not PUBLIC_DIR.is_dir():
        raise SystemExit(f"PUBLIC_DIR not found: {PUBLIC_DIR}")
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"chenchen-learning listening on http://{HOST}:{PORT}")
    print(f"  public: {PUBLIC_DIR}")
    print(f"  sqlite: {DB_PATH}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
