#!/usr/bin/env bash
# Spawn both Day-2 agents (intake + judge-technical) and stream their stdout
# to this terminal with a per-agent prefix. Ctrl-C kills both.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d "agents/intake/node_modules" ] || [ ! -d "agents/judge-technical/node_modules" ]; then
  echo "Missing node_modules in one or both agents. Run:"
  echo "  cd agents/intake && npm install"
  echo "  cd agents/judge-technical && npm install"
  exit 1
fi

mkdir -p logs

pids=()
cleanup() {
  echo
  echo "Shutting down agents..."
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

run_agent() {
  local name="$1"; shift
  local dir="$1"; shift
  ( cd "$dir" && node index.js 2>&1 ) | sed -u "s/^/[$name] /" &
  pids+=("$!")
}

run_agent intake          agents/intake
run_agent judge-technical agents/judge-technical

echo "Agents started. PIDs: ${pids[*]}. Ctrl-C to stop."
wait
