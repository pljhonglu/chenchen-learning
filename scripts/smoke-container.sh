#!/usr/bin/env bash
set -euo pipefail

# Disposable container and volume, isolated from deployment data.
image="${1:-chenchen-learning:test}"
name="chenchen-smoke-${RANDOM}-$$"
volume="${name}-data"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null
docker run -d --name "$name" -p 127.0.0.1::8080 -v "$volume:/data" "$image" >/dev/null
refresh_address() {
  port="$(docker port "$name" 8080/tcp | head -n 1 | sed 's/.*://')"
  base="http://127.0.0.1:$port"
}
refresh_address

wait_ready() {
  for attempt in $(seq 1 30); do
    if curl -fsS "$base/api/health" >/dev/null; then return 0; fi
    sleep 1
  done
  docker logs "$name"
  return 1
}
wait_ready
curl -fsS "$base/" | grep -q '辰辰'
python3 - "$base" <<'PY'
import json
import struct
import sys
from urllib.request import urlopen

base = sys.argv[1]
with urlopen(base + "/manifest.webmanifest") as response:
    assert response.headers.get_content_type() == "application/manifest+json"
    manifest = json.load(response)
assert manifest["display"] == "standalone" and manifest["start_url"] == "/"
assert {"192x192", "512x512"} <= {icon["sizes"] for icon in manifest["icons"] if icon["purpose"] == "any"}
for icon in manifest["icons"]:
    with urlopen(base + icon["src"]) as response:
        assert response.headers.get_content_type() == "image/png"
        header = response.read(24)
    assert header.startswith(b"\x89PNG\r\n\x1a\n")
    assert struct.unpack(">II", header[16:24]) == tuple(map(int, icon["sizes"].split("x")))
PY
poem_ids="$(curl -fsS "$base/data/poems.json" | python3 -c 'import json,sys; poems=json.load(sys.stdin); ids=[p["id"] for p in poems]; assert ids and len(set(ids)) == len(ids) and "poem-01" in ids; print(json.dumps(ids))')"
curl -fsS "$base/data/poem-illustrations.json" | python3 -c 'import json,sys; assert set(json.load(sys.stdin)) == set(json.loads(sys.argv[1]))' "$poem_ids"
curl -fsS "$base/images/poems/poem-01.webp" | python3 -c 'import sys; b=sys.stdin.buffer.read(); assert b[:4] == b"RIFF" and b[8:12] == b"WEBP"'
curl -fsS "$base/audio/poems/poem-01.mp3" | python3 -c 'import sys; assert len(sys.stdin.buffer.read()) > 4000'
curl -fsS -X PUT "$base/api/progress" -H 'Content-Type: application/json' \
  --data '{"payload":{"items":{"smoke":{"id":"smoke","learned":true,"title":"容器持久化检查"},"poem-01":{"id":"poem-01","learned":true,"stage":4,"nextReview":"2026-11-15"}}},"clientUpdatedAt":1000}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["kept"] == "client"'
docker restart "$name" >/dev/null
refresh_address
wait_ready
curl -fsS "$base/api/progress" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d["payload"]["items"]; ids=set(json.loads(sys.argv[1])); assert d["found"] and items["smoke"]["learned"] and set(items) == ids | {"smoke"} and all("learned" not in items[id] for id in ids) and d["updatedAt"] >= 1000; assert items["poem-01"]["stage"] == 4 and items["poem-01"]["nextReview"] == "2026-11-15"' "$poem_ids"
curl -fsS -X PATCH "$base/api/progress" -H 'Content-Type: application/json' \
  --data '{"operations":[{"op":"merge","collection":"items","key":"smoke","value":{"stage":1,"nextReview":"2026-10-02"}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["payload"]["items"]["smoke"]["stage"] == 1 and d["updatedAt"] > 1000'
docker restart "$name" >/dev/null
refresh_address
wait_ready
curl -fsS "$base/api/progress" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d["payload"]["items"]; assert items["smoke"]["stage"] == 1 and items["poem-01"]["stage"] == 4 and items["poem-01"]["nextReview"] == "2026-11-15"'
echo 'Container health, static resources and SQLite persistence passed.'
