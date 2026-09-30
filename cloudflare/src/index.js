/**
 * Chenchen learning progress sync API
 * GET  /api/progress?code=XXXX
 * PUT  /api/progress  { code, payload, clientUpdatedAt }
 * GET  /api/health
 */

const ALLOWED_ORIGINS = [
  "https://pljhonglu.github.io",
  "http://localhost",
  "http://127.0.0.1",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/** Best-effort in-memory rate limit (per isolate). */
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

function corsHeaders(origin) {
  const allow =
    origin &&
    (ALLOWED_ORIGINS.includes(origin) ||
      /^https:\/\/pljhonglu\.github\.io$/.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function rateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= RATE_MAX;
}

/** 6–8 chars: Crockford-ish alphabet (no I/L/O/U/0/1). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6,8}$/i;

function normalizeCode(code) {
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/gi, "");
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "payload must be a JSON object";
  }
  if (!payload.items || typeof payload.items !== "object") {
    return "payload.items required";
  }
  const raw = JSON.stringify(payload);
  if (raw.length > 400_000) return "payload too large";
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!rateLimit(ip)) {
      return json({ error: "rate_limited" }, 429, origin);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "chenchen-learning-api" }, 200, origin);
    }

    if (url.pathname === "/api/progress") {
      if (request.method === "GET") {
        return handleGet(url, env, origin);
      }
      if (request.method === "PUT") {
        return handlePut(request, env, origin);
      }
      return json({ error: "method_not_allowed" }, 405, origin);
    }

    return json(
      {
        error: "not_found",
        hint: "GET|PUT /api/progress , GET /api/health",
      },
      404,
      origin
    );
  },
};

async function handleGet(url, env, origin) {
  const code = normalizeCode(url.searchParams.get("code") || "");
  if (!CODE_RE.test(code)) {
    return json({ error: "invalid_code" }, 400, origin);
  }
  const row = await env.DB.prepare(
    "SELECT sync_code, payload, updated_at FROM progress WHERE sync_code = ?"
  )
    .bind(code)
    .first();
  if (!row) {
    return json({ found: false, code, payload: null, updatedAt: null }, 200, origin);
  }
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return json({ error: "corrupt_payload" }, 500, origin);
  }
  return json(
    {
      found: true,
      code: row.sync_code,
      payload,
      updatedAt: row.updated_at,
    },
    200,
    origin
  );
}

async function handlePut(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }
  const code = normalizeCode(body.code || "");
  if (!CODE_RE.test(code)) {
    return json({ error: "invalid_code" }, 400, origin);
  }
  const err = validatePayload(body.payload);
  if (err) return json({ error: err }, 400, origin);

  const clientUpdatedAt = Number(body.clientUpdatedAt) || Date.now();
  const now = Date.now();
  // Cap clock skew: accept client time if within 7 days of server
  let writeAt = clientUpdatedAt;
  if (Math.abs(clientUpdatedAt - now) > 7 * 24 * 3600 * 1000) {
    writeAt = now;
  }

  const existing = await env.DB.prepare(
    "SELECT payload, updated_at FROM progress WHERE sync_code = ?"
  )
    .bind(code)
    .first();

  if (existing && existing.updated_at > writeAt) {
    // Server newer: return current, do not overwrite
    let payload;
    try {
      payload = JSON.parse(existing.payload);
    } catch {
      payload = { items: {} };
    }
    return json(
      {
        ok: true,
        merged: false,
        kept: "server",
        code,
        payload,
        updatedAt: existing.updated_at,
      },
      200,
      origin
    );
  }

  const payloadStr = JSON.stringify(body.payload);
  await env.DB.prepare(
    `INSERT INTO progress (sync_code, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(sync_code) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= progress.updated_at`
  )
    .bind(code, payloadStr, writeAt)
    .run();

  const row = await env.DB.prepare(
    "SELECT payload, updated_at FROM progress WHERE sync_code = ?"
  )
    .bind(code)
    .first();

  return json(
    {
      ok: true,
      merged: true,
      kept: "client",
      code,
      payload: JSON.parse(row.payload),
      updatedAt: row.updated_at,
    },
    200,
    origin
  );
}
