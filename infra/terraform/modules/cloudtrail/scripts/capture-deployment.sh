#!/usr/bin/env bash
# =============================================================================
# capture-deployment.sh
# Capture all AWS API calls during a terragrunt deployment using iamlive
# Generates least-privilege IAM policies from actual API usage
# =============================================================================

set -euo pipefail

SITE_LABEL="${SITE_LABEL:-dc34}"
OUTPUT_DIR="${OUTPUT_DIR:-./captured-policies}"
ROLE_NAME="${1:-terragrunt}"

usage() {
    cat <<EOF
Usage: $0 [role-name] [terragrunt-command...]

Capture all AWS API calls during a terragrunt deployment and generate
a least-privilege IAM policy.

Arguments:
  role-name    Name for the output policy file (default: terragrunt)
  command...   Terragrunt command to run (default: run-all plan)

Requirements:
  - iamlive: brew install iann0036/iamlive/iamlive
  - Or: go install github.com/iann0036/iamlive@latest

Examples:
  # Capture a full plan
  $0 terragrunt run-all plan

  # Capture a full apply (generates complete deployment policy)
  $0 terragrunt run-all apply --auto-approve

  # Capture specific module
  $0 deploy plan -target=module.ecs

Environment Variables:
  SITE_LABEL   Site label prefix (default: dc34)
  OUTPUT_DIR   Directory for policy output (default: ./captured-policies)
  AWS_REGION   AWS region (default: us-east-1)
EOF
    exit 1
}

# Check for iamlive
if ! command -v iamlive &>/dev/null; then
    echo "Error: iamlive not found"
    echo ""
    echo "Install with:"
    echo "  brew install iann0036/iamlive/iamlive"
    echo "  # or"
    echo "  go install github.com/iann0036/iamlive@latest"
    exit 1
fi

# Parse arguments
shift || true  # Remove role-name from args
TERRAGRUNT_CMD="${*:-run-all plan}"

mkdir -p "$OUTPUT_DIR"
POLICY_FILE="${OUTPUT_DIR}/${ROLE_NAME}-policy-$(date +%Y%m%d-%H%M%S).json"

echo "=============================================="
echo "Capturing AWS API calls for: ${ROLE_NAME}"
echo "Command: terragrunt ${TERRAGRUNT_CMD}"
echo "Policy output: ${POLICY_FILE}"
echo "=============================================="

# Start iamlive in proxy mode (more reliable than CSM)
echo "Starting iamlive in proxy mode..."

# Generate CA cert if it doesn't exist
IAMLIVE_DIR="${HOME}/.iamlive"
mkdir -p "$IAMLIVE_DIR"

# Start iamlive in proxy mode
iamlive \
    --mode proxy \
    --bind-addr 127.0.0.1:10080 \
    --output-file "$POLICY_FILE" \
    --refresh-rate 1 \
    --sort-alphabetical \
    --set-ini \
    --force-wildcard-resource \
    &

IAMLIVE_PID=$!
sleep 3

# Configure AWS CLI/SDK to use the proxy
export HTTP_PROXY=http://127.0.0.1:10080
export HTTPS_PROXY=http://127.0.0.1:10080
export AWS_CA_BUNDLE="${IAMLIVE_DIR}/ca.pem"

# Verify iamlive is running
if ! kill -0 $IAMLIVE_PID 2>/dev/null; then
    echo "Error: Failed to start iamlive"
    exit 1
fi

echo "iamlive running (PID: $IAMLIVE_PID)"

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping iamlive..."

    # Send SIGHUP to flush the policy file, then terminate
    kill -HUP $IAMLIVE_PID 2>/dev/null || true
    sleep 1
    kill $IAMLIVE_PID 2>/dev/null || true
    sleep 2

    # Unset proxy environment
    unset HTTP_PROXY HTTPS_PROXY AWS_CA_BUNDLE

    # Give iamlive time to write the final policy
    if [[ -f "$POLICY_FILE" ]]; then
        echo ""
        echo "=============================================="
        echo "Captured Policy:"
        echo "=============================================="
        cat "$POLICY_FILE"
        echo ""
        echo "Policy saved to: ${POLICY_FILE}"
    else
        echo ""
        echo "Warning: No policy file generated. iamlive may not have captured any calls."
        echo "Try running iamlive manually to debug:"
        echo "  iamlive --mode proxy --set-ini"
        echo "  # In another terminal: terragrunt run-all plan"
    fi
}
trap cleanup EXIT

# Run terragrunt command
echo ""
echo "Running: terragrunt ${TERRAGRUNT_CMD}"
echo "=============================================="

# shellcheck disable=SC2086
terragrunt $TERRAGRUNT_CMD

echo ""
echo "Terragrunt command completed."
