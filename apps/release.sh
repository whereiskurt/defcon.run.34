#!/bin/bash
# Full release pipeline - bumps versions, builds images, and deploys to ECS
# Usage: ./release.sh <app>
# Examples:
#   ./release.sh run.auth
#   ./release.sh run.human

set -e

APP="${1}"

if [[ -z "$APP" ]]; then
  echo "Usage: ./release.sh <app>"
  echo "  app: run.auth | run.human"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth' or 'run.human'"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Starting release for ${APP} ==="
echo "$(date)"

# Bump versions
echo "=== Bumping nginx version ==="
"${SCRIPT_DIR}/version.sh" nginx "$APP"
echo "=== Bumping webapp version ==="
"${SCRIPT_DIR}/version.sh" webapp "$APP"

# Build and push images
echo "=== Building nginx ==="
"${SCRIPT_DIR}/build.sh" nginx "$APP"
echo "=== Building webapp ==="
"${SCRIPT_DIR}/build.sh" webapp "$APP"

# Deploy to ECS
echo "=== Deploying to ECS ==="
"${SCRIPT_DIR}/deploy.sh" "$APP"

echo "=== Release complete for ${APP} ==="
echo "$(date)"
