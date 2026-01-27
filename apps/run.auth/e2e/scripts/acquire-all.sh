#!/bin/bash
#
# Acquire credentials for all test accounts (a, b, c) in parallel
#
# Usage:
#   ./scripts/acquire-all.sh                    # Local (localhost:3002)
#   ./scripts/acquire-all.sh --prod             # Production (auth.defcon.run)
#   ./scripts/acquire-all.sh --force            # Force fresh login
#   ./scripts/acquire-all.sh --clean            # Cleanup DynamoDB first
#   ./scripts/acquire-all.sh --prod --clean     # Production with cleanup
#
# This script runs three parallel processes to acquire credentials for
# accounta, accountb, and accountc. Each process waits for its verification
# email (up to 2 minutes) and saves the session cookies.
#

set -e
cd "$(dirname "$0")/.."

# Parse arguments
FORCE=""
CLEAN=false
BASE_URL="http://localhost:3002"

for arg in "$@"; do
  case $arg in
    --prod|--production)
      BASE_URL="https://auth.defcon.run"
      ;;
    --force)
      FORCE="FORCE_FRESH=true"
      ;;
    --clean|--cleanup)
      CLEAN=true
      ;;
  esac
done

echo "============================================================"
echo "Acquiring credentials for all accounts"
echo "============================================================"
echo "Base URL: $BASE_URL"
echo "Force:    ${FORCE:-no}"
echo "Cleanup:  $CLEAN"
echo "============================================================"
echo ""

# Run cleanup if requested
if [ "$CLEAN" = true ]; then
  echo "Running DynamoDB cleanup..."
  echo ""
  if CLEANUP_EXECUTE=true npx playwright test setup/cleanup-test-users.spec.ts --reporter=line; then
    echo ""
    echo "Cleanup complete."
    # Force fresh login after cleanup
    FORCE="FORCE_FRESH=true"
  else
    echo "Cleanup failed, but continuing..."
  fi
  echo ""
fi

# Function to acquire credentials for a single account
acquire_account() {
  local role=$1
  local logfile="/tmp/e2e-acquire-${role}.log"

  echo "[${role}] Starting acquisition..."

  if env ${FORCE} TEST_USER_ROLE="${role}" BASE_URL="${BASE_URL}" \
    npx playwright test setup/acquire-credentials.spec.ts --reporter=line > "${logfile}" 2>&1; then
    echo "[${role}] SUCCESS - credentials acquired"
  else
    echo "[${role}] FAILED - check ${logfile}"
    return 1
  fi
}

# Run all three in parallel
echo "Starting parallel acquisition..."
echo ""

acquire_account "accounta" &
PID_A=$!

acquire_account "accountb" &
PID_B=$!

acquire_account "accountc" &
PID_C=$!

# Wait for all to complete
echo "Waiting for all accounts..."
echo ""

FAILED=0

wait $PID_A || { echo "[accounta] FAILED"; FAILED=1; }
wait $PID_B || { echo "[accountb] FAILED"; FAILED=1; }
wait $PID_C || { echo "[accountc] FAILED"; FAILED=1; }

echo ""
echo "============================================================"

if [ $FAILED -eq 0 ]; then
  echo "SUCCESS: All credentials acquired"
  echo ""
  echo "Cookie jars:"
  ls -la .auth/cookies-*.json 2>/dev/null || echo "  (none found)"
  echo ""
  echo "Next steps:"
  echo "  # Validate sessions"
  echo "  npx playwright test tests/session-valid.spec.ts"
  echo ""
  echo "  # Run service access tests"
  echo "  npx playwright test tests/service-access.spec.ts"
else
  echo "FAILED: Some credentials could not be acquired"
  echo ""
  echo "Check logs:"
  echo "  cat /tmp/e2e-acquire-accounta.log"
  echo "  cat /tmp/e2e-acquire-accountb.log"
  echo "  cat /tmp/e2e-acquire-accountc.log"
  exit 1
fi

echo "============================================================"
