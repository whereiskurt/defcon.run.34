#!/bin/bash
# Increments patch version in VERSION file
# Usage: ./version.sh <component> <app>
# Examples:
#   ./version.sh nginx run.auth
#   ./version.sh webapp run.auth
#   ./version.sh nginx run.human
#   ./version.sh webapp run.human

set -e

COMPONENT="${1}"
APP="${2}"

if [[ -z "$COMPONENT" || -z "$APP" ]]; then
  echo "Usage: ./version.sh <component> <app>"
  echo "  component: nginx | webapp"
  echo "  app: run.auth | run.human"
  exit 1
fi

if [[ "$COMPONENT" != "nginx" && "$COMPONENT" != "webapp" ]]; then
  echo "ERROR: Invalid component '$COMPONENT'. Must be 'nginx' or 'webapp'"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth' or 'run.human'"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/${APP}/${COMPONENT}/VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: VERSION file not found at $VERSION_FILE"
  exit 1
fi

CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
echo "Current version: $CURRENT_VERSION"

# Parse version (expects format vX.Y.Z)
if [[ ! "$CURRENT_VERSION" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "ERROR: Invalid version format. Expected vX.Y.Z, got: $CURRENT_VERSION"
  exit 1
fi

MAJOR="${BASH_REMATCH[1]}"
MINOR="${BASH_REMATCH[2]}"
PATCH="${BASH_REMATCH[3]}"

NEW_PATCH=$((PATCH + 1))
NEW_VERSION="v${MAJOR}.${MINOR}.${NEW_PATCH}"

echo "$NEW_VERSION" > "$VERSION_FILE"
echo "Updated version: $NEW_VERSION"
