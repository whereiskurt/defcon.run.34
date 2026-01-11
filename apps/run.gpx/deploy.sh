#!/bin/bash
# Deploys run.gpx to ECS
# Usage: ./deploy.sh
#
# Wrapper script that calls apps/deploy.sh with run.gpx.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== run.gpx deploy script ==="
echo "VERSION: $(cat "${SCRIPT_DIR}/VERSION")"
echo ""

# Call the main deploy script
exec "${APPS_DIR}/deploy.sh" "run.gpx"
