#!/bin/bash
# Builds run.gpx Docker image and pushes to ECR
# Usage: ./build.sh [webapp]
#
# Wrapper script that calls apps/build.sh with run.gpx parameters.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$(dirname "$SCRIPT_DIR")"

COMPONENT="${1:-webapp}"

echo "=== run.gpx build script ==="
echo "Building: ${COMPONENT}"
echo "VERSION: $(cat "${SCRIPT_DIR}/VERSION")"
echo ""

# Call the main build script
exec "${APPS_DIR}/build.sh" "${COMPONENT}" "run.gpx"
