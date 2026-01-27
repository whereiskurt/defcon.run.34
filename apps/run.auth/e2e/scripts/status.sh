#!/bin/bash
#
# Check status of credential cookie jars
#
# Usage:
#   ./scripts/status.sh
#

cd "$(dirname "$0")/.."

echo "============================================================"
echo "E2E Test Credential Status"
echo "============================================================"
echo ""

check_jar() {
  local file=$1
  local name=$2

  if [ -f "$file" ]; then
    local expires=$(cat "$file" | grep -o '"expiresAt":"[^"]*"' | cut -d'"' -f4)
    local saved=$(cat "$file" | grep -o '"savedAt":"[^"]*"' | cut -d'"' -f4)

    # Check if expired
    local expires_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${expires%%.*}" +%s 2>/dev/null || echo 0)
    local now_epoch=$(date +%s)

    if [ "$expires_epoch" -gt "$now_epoch" ]; then
      echo "[✓] $name"
      echo "    Saved:   $saved"
      echo "    Expires: $expires"
    else
      echo "[✗] $name (EXPIRED)"
      echo "    Saved:   $saved"
      echo "    Expires: $expires"
    fi
  else
    echo "[ ] $name (not found)"
  fi
  echo ""
}

echo "Production credentials:"
check_jar ".auth/cookies-accounta.json" "accounta"
check_jar ".auth/cookies-accountb.json" "accountb"
check_jar ".auth/cookies-accountc.json" "accountc"

echo "Local credentials:"
check_jar ".auth/cookies-local-accounta.json" "accounta (local)"
check_jar ".auth/cookies-local-accountb.json" "accountb (local)"
check_jar ".auth/cookies-local-accountc.json" "accountc (local)"

echo "============================================================"
echo "Commands:"
echo ""
echo "  # Acquire single account (production)"
echo "  BASE_URL=https://auth.defcon.run TEST_USER_ROLE=accounta \\"
echo "    npx playwright test setup/acquire-credentials.spec.ts"
echo ""
echo "  # Acquire all accounts (parallel)"
echo "  ./scripts/acquire-all.sh --prod"
echo ""
echo "  # Validate sessions"
echo "  BASE_URL=https://auth.defcon.run \\"
echo "    npx playwright test tests/session-valid.spec.ts"
echo "============================================================"
