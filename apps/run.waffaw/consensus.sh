#!/bin/bash
# waffaw roll call consensus protocol
# Gives every node a deterministic rank without leader election.
# Relies on S3 strong read-after-write consistency.
#
# Usage: source consensus.sh && run_consensus
# After completion, NODE_RANK, NODE_TOTAL, NODE_PEERS are exported.
set -euo pipefail

CONSENSUS_PREFIX="consensus/current"
ROLLCALL_TIMEOUT=${ROLLCALL_TIMEOUT:-90}
CONFIRM_TIMEOUT=${CONFIRM_TIMEOUT:-60}
POLL_WAIT=5

# --- Phase 1: ROLL CALL ---
phase_roll_call() {
  local expected_nodes="${1:-5}"
  echo "[consensus] Phase 1: ROLL CALL (expecting ${expected_nodes} nodes, timeout ${ROLLCALL_TIMEOUT}s)"

  # Write our check-in
  local checkin
  checkin=$(cat <<EOF
{
  "ip": "${MY_IP}",
  "region": "${REGION}",
  "node_type": "${NODE_TYPE}",
  "node_id": "${NODE_ID}",
  "instance_type": "${INSTANCE_TYPE}",
  "checked_in_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)
  echo "$checkin" | aws s3 cp - "s3://${CONTROL_BUCKET}/${CONSENSUS_PREFIX}/roll-call/${MY_IP}.json" --quiet

  # Poll until enough nodes or timeout
  local elapsed=0
  local count=0
  while [[ $elapsed -lt $ROLLCALL_TIMEOUT ]]; do
    count=$(aws s3 ls "s3://${CONTROL_BUCKET}/${CONSENSUS_PREFIX}/roll-call/" 2>/dev/null | wc -l | tr -d ' ')
    echo "[consensus] roll-call: ${count}/${expected_nodes} nodes checked in (${elapsed}s elapsed)"
    if [[ $count -ge $expected_nodes ]]; then
      echo "[consensus] all expected nodes present"
      break
    fi
    sleep "$POLL_WAIT"
    elapsed=$((elapsed + POLL_WAIT))
  done

  if [[ $count -lt $expected_nodes ]]; then
    echo "[consensus] timeout reached with ${count}/${expected_nodes} nodes — proceeding with available nodes"
  fi
}

# --- Phase 2: ROSTER ---
phase_roster() {
  echo "[consensus] Phase 2: ROSTER — computing rank"

  # List all roll-call entries, extract IPs from filenames
  local ips
  ips=$(aws s3 ls "s3://${CONTROL_BUCKET}/${CONSENSUS_PREFIX}/roll-call/" 2>/dev/null \
    | awk '{print $NF}' \
    | sed 's/\.json$//' \
    | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n)

  local total
  total=$(echo "$ips" | wc -l | tr -d ' ')
  local rank=0
  local i=0
  local peers=""

  while IFS= read -r ip; do
    i=$((i + 1))
    if [[ "$ip" == "$MY_IP" ]]; then
      rank=$i
    fi
    if [[ -n "$peers" ]]; then
      peers="${peers},${ip}"
    else
      peers="$ip"
    fi
  done <<< "$ips"

  if [[ $rank -eq 0 ]]; then
    echo "[consensus] ERROR: own IP ${MY_IP} not found in roll-call" >&2
    rank=1
  fi

  export NODE_RANK=$rank
  export NODE_TOTAL=$total
  export NODE_PEERS=$peers

  echo "[consensus] rank=${NODE_RANK}/${NODE_TOTAL} peers=${NODE_PEERS}"

  # Write roster entry
  local roster
  roster=$(cat <<EOF
{
  "ip": "${MY_IP}",
  "rank": ${NODE_RANK},
  "total": ${NODE_TOTAL},
  "roster": [$(echo "$ips" | sed 's/^/"/;s/$/"/' | paste -sd, -)]
}
EOF
)
  echo "$roster" | aws s3 cp - "s3://${CONTROL_BUCKET}/${CONSENSUS_PREFIX}/roster.d/${MY_IP}.json" --quiet
}

# --- Phase 3: CONFIRMATION ---
phase_confirm() {
  echo "[consensus] Phase 3: CONFIRMATION (waiting for ${NODE_TOTAL} roster entries, timeout ${CONFIRM_TIMEOUT}s)"

  local elapsed=0
  while [[ $elapsed -lt $CONFIRM_TIMEOUT ]]; do
    local confirmed
    confirmed=$(aws s3 ls "s3://${CONTROL_BUCKET}/${CONSENSUS_PREFIX}/roster.d/" 2>/dev/null | wc -l | tr -d ' ')
    echo "[consensus] confirmed: ${confirmed}/${NODE_TOTAL} (${elapsed}s elapsed)"
    if [[ $confirmed -ge $NODE_TOTAL ]]; then
      echo "[consensus] all nodes confirmed — consensus achieved"
      return 0
    fi
    sleep "$POLL_WAIT"
    elapsed=$((elapsed + POLL_WAIT))
  done

  echo "[consensus] confirmation timeout — proceeding with partial consensus"
}

# --- Entry point ---
run_consensus() {
  local expected="${1:-${EXPECTED_NODES:-5}}"
  phase_roll_call "$expected"
  phase_roster
  phase_confirm
  echo "[consensus] complete: NODE_RANK=${NODE_RANK} NODE_TOTAL=${NODE_TOTAL}"
}

# If executed directly (not sourced), run consensus
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_consensus "$@"
fi
