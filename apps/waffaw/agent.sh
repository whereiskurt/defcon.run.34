#!/bin/bash
# waffaw agent — S3 polling daemon (container entrypoint)
# Runs as PID 1 on every node (EC2 and Fargate).
set -euo pipefail

AGENT_VERSION="${IMAGE_TAG:-1.0.7}"
POLL_INTERVAL=30
EXECUTED_DIR="/tmp/waffaw/executed"
OUTPUT_DIR="/tmp/waffaw/output"

mkdir -p "$EXECUTED_DIR" "$OUTPUT_DIR"

# --- IMDSv2 helper (EC2 requires token-based requests) ---
imds_get() {
  local path="$1"
  local token
  token=$(curl -sf --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null) || return 1
  curl -sf --connect-timeout 2 -H "X-aws-ec2-metadata-token: $token" \
    "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null
}

# --- IP Discovery ---
discover_ip() {
  local ip
  # Try IMDSv2 first (EC2 with http_tokens=required)
  ip=$(imds_get "public-ipv4") && [[ -n "$ip" ]] && { echo "$ip"; return; }
  # Fallback: checkip.amazonaws.com (works on Fargate and when IMDS unavailable)
  ip=$(curl -sf --connect-timeout 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]') && { echo "$ip"; return; }
  echo "FATAL: could not discover public IP" >&2
  exit 1
}

# --- Determine node identity ---
discover_node_id() {
  local nid
  nid=$(imds_get "instance-id") && [[ -n "$nid" ]] && { echo "$nid"; return; }
  echo "$(hostname)"
}

discover_instance_type() {
  local itype
  itype=$(imds_get "instance-type") && [[ -n "$itype" ]] && { echo "$itype"; return; }
  echo "fargate"
}

# --- Exports ---
export MY_IP
MY_IP=$(discover_ip)
export REGION="${REGION:-us-east-1}"
export NODE_ID
NODE_ID=$(discover_node_id)
export NODE_TYPE="${NODE_TYPE:-fargate}"
export INSTANCE_TYPE
INSTANCE_TYPE=$(discover_instance_type)
export CONTROL_BUCKET="${CONTROL_BUCKET:?CONTROL_BUCKET is required}"
export LOG_LEVEL="${LOG_LEVEL:-normal}"
export SCENARIOS_DIR="/opt/waffaw/scenarios"
export TEMPLATES_DIR="/opt/waffaw/templates"
export DATA_DIR="/opt/waffaw/data"
export OUTPUT_DIR

# Consensus vars — set after roll call
export NODE_RANK=0
export NODE_TOTAL=0
export NODE_PEERS=""
export CAMPAIGN_NAME=""

STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[agent] waffaw agent v${AGENT_VERSION} starting"
echo "[agent] IP=${MY_IP} REGION=${REGION} NODE_ID=${NODE_ID} NODE_TYPE=${NODE_TYPE}"

# --- Self-register ---
register() {
  local meta
  meta=$(cat <<EOF
{
  "ip": "${MY_IP}",
  "region": "${REGION}",
  "node_id": "${NODE_ID}",
  "node_type": "${NODE_TYPE}",
  "instance_type": "${INSTANCE_TYPE}",
  "started_at": "${STARTED_AT}",
  "agent_version": "${AGENT_VERSION}"
}
EOF
)
  echo "$meta" | aws s3 cp - "s3://${CONTROL_BUCKET}/nodes/${MY_IP}/meta.json" --quiet
  echo "[agent] registered at nodes/${MY_IP}/meta.json"
}

# --- Heartbeat ---
heartbeat() {
  date -u +"%Y-%m-%dT%H:%M:%SZ" | aws s3 cp - "s3://${CONTROL_BUCKET}/nodes/${MY_IP}/alive.txt" --quiet
}

# --- Deregister on shutdown ---
deregister() {
  # Prevent re-entry (kill 0 sends SIGTERM to our process group)
  trap - SIGTERM SIGINT
  echo "[agent] SIGTERM received — deregistering"
  # Kill all children
  kill -- -$$ 2>/dev/null || kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  aws s3 rm "s3://${CONTROL_BUCKET}/nodes/${MY_IP}/" --recursive --quiet 2>/dev/null || true
  echo "[agent] deregistered, exiting"
  exit 0
}
trap deregister SIGTERM SIGINT

# --- Script execution (content-hash tracked) ---
run_scripts() {
  local prefix="$1"
  local script_list
  script_list=$(aws s3 ls "s3://${CONTROL_BUCKET}/${prefix}" 2>/dev/null | awk '{print $NF}') || return 0

  for script_name in $script_list; do
    [[ -z "$script_name" ]] && continue
    local tmp_script="/tmp/waffaw/${script_name}"
    aws s3 cp "s3://${CONTROL_BUCKET}/${prefix}${script_name}" "$tmp_script" --quiet 2>/dev/null || continue

    # SHA-256 content hash — first 12 hex chars
    local hash
    hash=$(sha256sum "$tmp_script" | cut -c1-12)

    if [[ -f "${EXECUTED_DIR}/${hash}" ]]; then
      rm -f "$tmp_script"
      continue
    fi

    echo "[agent] executing ${prefix}${script_name} (hash=${hash})"
    chmod +x "$tmp_script"
    local log_file="${OUTPUT_DIR}/${script_name}.$(date -u +%Y%m%d-%H%M%S).log"

    # Mark as executed BEFORE launching (prevents re-execution on next poll)
    touch "${EXECUTED_DIR}/${hash}"

    # Run in background; cleanup script file INSIDE the subshell after execution
    (
      "$tmp_script" 2>&1 | tee "$log_file"
      rm -f "$tmp_script"
      aws s3 cp "$log_file" "s3://${CONTROL_BUCKET}/nodes/${MY_IP}/output/$(basename "$log_file")" --quiet 2>/dev/null || true
    ) &
  done
}

# --- Check for halt flag ---
check_halt() {
  if aws s3 ls "s3://${CONTROL_BUCKET}/global/halt" &>/dev/null; then
    return 0
  fi
  return 1
}

# --- Read campaign state ---
read_campaign_state() {
  local state_file="/tmp/waffaw/campaign-state.json"
  if aws s3 cp "s3://${CONTROL_BUCKET}/campaign-state.json" "$state_file" --quiet 2>/dev/null; then
    CAMPAIGN_NAME=$(jq -r '.campaign // ""' "$state_file" 2>/dev/null || echo "")
    export CAMPAIGN_NAME
  fi
}

# === Main ===
register
heartbeat

echo "[agent] entering main loop (poll every ${POLL_INTERVAL}s)"

while true; do
  # Heartbeat
  heartbeat

  # Halt check
  if check_halt; then
    echo "[agent] HALT flag detected — killing children"
    jobs -p | xargs -r kill 2>/dev/null || true
    wait 2>/dev/null || true
    echo "[agent] halted, waiting for halt to clear..."
    while check_halt; do
      sleep "$POLL_INTERVAL"
      heartbeat
    done
    echo "[agent] halt cleared, resuming"
  fi

  # Read campaign state for env vars
  read_campaign_state

  # Run global scripts
  run_scripts "global/run/"

  # Run node-specific scripts
  run_scripts "nodes/${MY_IP}/run/"

  sleep "$POLL_INTERVAL" &
  wait $!
done
