#!/usr/bin/env bash
# Starts/stops local MongoDB, Qdrant and (if needed) Redis without Docker.
# Binaries are resolved from PATH first, then from ./.tools (see scripts/install-tools.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data"
mkdir -p "$DATA/mongo" "$DATA/qdrant" "$DATA/logs"

bin() { command -v "$1" 2>/dev/null || { [ -x "$ROOT/.tools/$2" ] && echo "$ROOT/.tools/$2"; } || true; }
MONGOD="$(bin mongod mongodb/bin/mongod)"
QDRANT="$(bin qdrant qdrant/qdrant)"
REDIS="$(bin redis-server none)"

up() {
  if nc -z 127.0.0.1 27017 2>/dev/null; then echo "mongodb: already running"; else
    [ -n "$MONGOD" ] || { echo "mongod not found; run scripts/install-tools.sh" >&2; exit 1; }
    # --fork is unsupported on macOS, so background it ourselves.
    nohup "$MONGOD" --dbpath "$DATA/mongo" --bind_ip 127.0.0.1 --port 27017 --logpath "$DATA/logs/mongod.log" >/dev/null 2>&1 &
    echo $! >"$DATA/mongod.pid"
    echo "mongodb: started"
  fi
  if nc -z 127.0.0.1 6333 2>/dev/null; then echo "qdrant: already running"; else
    [ -n "$QDRANT" ] || { echo "qdrant not found; run scripts/install-tools.sh" >&2; exit 1; }
    (cd "$DATA/qdrant" && QDRANT__STORAGE__STORAGE_PATH="$DATA/qdrant/storage" QDRANT__SERVICE__HOST=127.0.0.1 QDRANT__TELEMETRY_DISABLED=true \
      nohup "$QDRANT" >"$DATA/logs/qdrant.log" 2>&1 & echo $! >"$DATA/qdrant.pid")
    echo "qdrant: started"
  fi
  if nc -z 127.0.0.1 6379 2>/dev/null; then echo "redis: already running"; else
    [ -n "$REDIS" ] || { echo "redis-server not found (brew install redis)" >&2; exit 1; }
    "$REDIS" --daemonize yes --dir "$DATA" --appendonly yes --logfile "$DATA/logs/redis.log" --pidfile "$DATA/redis.pid"
    echo "redis: started"
  fi
}

down() {
  if [ -f "$DATA/mongod.pid" ]; then kill "$(cat "$DATA/mongod.pid")" 2>/dev/null && echo "mongodb: stopped"; rm -f "$DATA/mongod.pid"; fi
  if [ -f "$DATA/qdrant.pid" ]; then kill "$(cat "$DATA/qdrant.pid")" 2>/dev/null && echo "qdrant: stopped"; rm -f "$DATA/qdrant.pid"; fi
  if [ -f "$DATA/redis.pid" ]; then kill "$(cat "$DATA/redis.pid")" 2>/dev/null && echo "redis: stopped"; rm -f "$DATA/redis.pid"; fi
}

status() {
  for s in "mongodb 27017" "qdrant 6333" "redis 6379"; do set -- $s
    nc -z 127.0.0.1 "$2" 2>/dev/null && echo "$1: up (:$2)" || echo "$1: down (:$2)"; done
}

case "${1:-status}" in up) up ;; down) down ;; status) status ;; *) echo "usage: $0 up|down|status"; exit 1 ;; esac
