#!/usr/bin/env bash
# Spawn all Phase 1 services (4 agents + log-streamer) and stream their
# stdout to this terminal with a per-service prefix. Each service also gets
# its own logs/<name>.stdout.log for crash diagnostics. Ctrl-C kills everyone.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

services=(
  "intake|agents/intake|4001"
  "judge-technical|agents/judge-technical|4002"
  "judge-originality|agents/judge-originality|4003"
  "judge-skeptic|agents/judge-skeptic|4004"
  "log-streamer|log-streamer|4100"
)

missing=()
for svc in "${services[@]}"; do
  IFS='|' read -r name dir _port <<< "$svc"
  if [ ! -d "$dir/node_modules" ]; then
    missing+=("$dir")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing node_modules in:"
  for d in "${missing[@]}"; do
    echo "  $d   (run: cd $d && npm install)"
  done
  exit 1
fi

mkdir -p logs

pids=()
cleanup() {
  echo
  echo "Shutting down services..."
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

run_service() {
  local name="$1"; shift
  local dir="$1"; shift
  local stdout_log="logs/${name}.stdout.log"
  ( cd "$dir" && node index.js 2>&1 ) | tee -a "$stdout_log" | sed -u "s/^/[$name] /" &
  pids+=("$!")
}

for svc in "${services[@]}"; do
  IFS='|' read -r name dir _port <<< "$svc"
  run_service "$name" "$dir"
done

echo "Services started. PIDs: ${pids[*]}"
echo "Ports: intake=4001 technical=4002 originality=4003 skeptic=4004 log-streamer=4100"
echo "Ctrl-C to stop. Or run: ./scripts/stop-all.sh"
wait
