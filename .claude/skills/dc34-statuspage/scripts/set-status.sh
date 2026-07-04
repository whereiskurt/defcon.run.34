#!/usr/bin/env bash
#
# set-status.sh — set the `state` of one or more services in the status.defcon.run
# data file (apps/run.status/site/status.json). Validates ids + states; edits ONLY
# the matched services' `state` field; never touches `updated` (release.sh stamps it).
#
# Usage:
#   set-status.sh <id>=<state> [<id>=<state> ...]
#   state ∈ { live | dev | down }
#
# Example:
#   set-status.sh human=down gpx=down
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
JSON="${ROOT}/apps/run.status/site/status.json"

command -v jq >/dev/null 2>&1 || { echo "jq is required but not found" >&2; exit 1; }
[ -f "$JSON" ] || { echo "status.json not found at $JSON" >&2; exit 1; }
[ "$#" -ge 1 ] || { echo "usage: set-status.sh <id>=<state> [<id>=<state> ...]  (state ∈ live|dev|down)" >&2; exit 2; }

tmp="$(mktemp)"; trap 'rm -f "$tmp" "$tmp.next"' EXIT
cp "$JSON" "$tmp"

for pair in "$@"; do
  id="${pair%%=*}"
  state="${pair#*=}"
  case "$state" in
    live|dev|down) ;;
    *) echo "invalid state '$state' for '$id' (use live|dev|down)" >&2; exit 2 ;;
  esac
  if [ "$(jq --arg id "$id" '[.services[] | select(.id==$id)] | length' "$tmp")" -eq 0 ]; then
    echo "unknown service id '$id' (valid: $(jq -r '[.services[].id] | join(", ")' "$tmp"))" >&2
    exit 2
  fi
  jq --arg id "$id" --arg st "$state" \
    '(.services[] | select(.id==$id) | .state) = $st' "$tmp" > "$tmp.next"
  mv "$tmp.next" "$tmp"
  echo "  ${id} -> ${state}"
done

mv "$tmp" "$JSON"
trap - EXIT
echo "Updated ${JSON}"
echo "Next: cd apps/run.status && ./release.sh --status-only"
