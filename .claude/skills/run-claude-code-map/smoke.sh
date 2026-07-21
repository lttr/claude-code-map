#!/usr/bin/env bash
# Smoke test for claude-code-map. Run from the repo root:
#   bash .claude/skills/run-claude-code-map/smoke.sh [port]
set -u
PORT="${1:-7893}"
OUT="$(mktemp -d)/atlas.html"
fail() { echo "SMOKE FAIL: $1" >&2; [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null; exit 1; }

node bin/cli.ts --port "$PORT" & PID=$!
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

curl -sf "http://127.0.0.1:$PORT/" | grep -q '<title>Map of my Servitors</title>' \
  || fail "shell page missing title"
curl -sf -o /dev/null "http://127.0.0.1:$PORT/atlas.css" \
  || fail "atlas.css not served"
FRAG=$(curl -sf "http://127.0.0.1:$PORT/atlas.html") || fail "atlas.html fragment errored"
echo "$FRAG" | grep -q 'proj-head' || fail "fragment missing project cards"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/nope")" = 404 ] \
  || fail "unknown route not 404"

kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null

node bin/cli.ts --out "$OUT" | grep '^tally:' || fail "--out printed no tally"
[ -s "$OUT" ] || fail "--out wrote empty file"

echo "SMOKE OK"
