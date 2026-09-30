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
curl -fsS "$base/data/poems.json" | python3 -c 'import json,sys; assert len(json.load(sys.stdin)) > 0'
curl -fsS -X PUT "$base/api/progress" -H 'Content-Type: application/json' \
  --data '{"payload":{"items":{"smoke":{"id":"smoke","learned":true,"title":"容器持久化检查"}}},"clientUpdatedAt":1000}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["kept"] == "client"'
docker restart "$name" >/dev/null
refresh_address
wait_ready
curl -fsS "$base/api/progress" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["found"] and d["payload"]["items"]["smoke"]["learned"] and d["updatedAt"] == 1000'
curl -fsS -X PATCH "$base/api/progress" -H 'Content-Type: application/json' \
  --data '{"operations":[{"op":"merge","collection":"items","key":"smoke","value":{"stage":1,"nextReview":"2026-10-02"}}]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["payload"]["items"]["smoke"]["stage"] == 1 and d["updatedAt"] > 1000'
docker restart "$name" >/dev/null
refresh_address
wait_ready
curl -fsS "$base/api/progress" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["payload"]["items"]["smoke"]["stage"] == 1'
echo 'Container health, static resources and SQLite persistence passed.'
