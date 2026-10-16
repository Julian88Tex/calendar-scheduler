#!/usr/bin/env bash
# Machine budget guard (ARCHITECTURE section 26 rule 18): at most two holders per slot run at once.
#
#   scripts/heavy.sh server <command...>   next dev, next start, next build, Playwright
#   scripts/heavy.sh tsc <command...>      tsc, next typegen
#
# Takes `flock -n` on /tmp/kairos-heavy-<slot>.1.lock or .2.lock, retrying every 10 seconds until one is free, then
# execs the command with the lock file descriptor inherited (the lock lasts as long as the command and its children).
# Nested calls for the same slot (for example typecheck:owned running typegen and tsc) reuse the held slot.
set -euo pipefail

usage() {
  echo "usage: scripts/heavy.sh <server|tsc> <command...>" >&2
  exit 2
}

[ $# -ge 2 ] || usage
slot="$1"
shift
case "$slot" in
  server | tsc) ;;
  *) usage ;;
esac

# Already holding this slot (nested call): run directly.
if [ "${KAIROS_HEAVY_SLOT:-}" = "$slot" ]; then
  exec "$@"
fi

# No flock (for example macOS without util-linux): run unguarded.
if ! command -v flock >/dev/null 2>&1; then
  exec "$@"
fi

waited=0
while true; do
  for n in 1 2; do
    lock="/tmp/kairos-heavy-${slot}.${n}.lock"
    exec {fd}>>"$lock"
    if flock -n "$fd"; then
      export KAIROS_HEAVY_SLOT="$slot"
      export KAIROS_HEAVY_LOCK="$lock"
      [ "$waited" -gt 0 ] && echo "[heavy] acquired ${lock} after ${waited}s" >&2
      exec "$@"
    fi
    exec {fd}>&-
  done
  [ $((waited % 60)) -eq 0 ] && echo "[heavy] both ${slot} slots are busy, retrying every 10s ..." >&2
  sleep 10
  waited=$((waited + 10))
done
