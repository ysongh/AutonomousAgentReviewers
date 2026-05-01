#!/usr/bin/env bash
# Kill anything listening on the Phase 1 ports. Useful when start-all.sh was
# backgrounded, crashed, or its terminal is gone.

set -euo pipefail

ports=(4001 4002 4003 4004 4005 4100)

any_killed=0
for port in "${ports[@]}"; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Killing port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    any_killed=1
  fi
done

if [ "$any_killed" -eq 0 ]; then
  echo "Nothing listening on ${ports[*]}."
fi
