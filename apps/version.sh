#!/bin/bash
# Increments patch version in VERSION file
# Usage: ./version.sh <component> <app>
# Examples:
#   ./version.sh nginx run.auth
#   ./version.sh webapp run.auth
#   ./version.sh nginx run.human
#   ./version.sh webapp run.human
#   ./version.sh nginx run.cms
#   ./version.sh app run.cms
#   ./version.sh webapp run.gpx
#   ./version.sh mosquitto run.mqtt
#   ./version.sh meshtk run.mqtt
#   ./version.sh nginx run.mqtt

set -e

COMPONENT="${1}"
APP="${2}"

if [[ -z "$COMPONENT" || -z "$APP" ]]; then
  echo "Usage: ./version.sh <component> <app>"
  echo "  component: nginx | webapp | app | mosquitto | meshtk"
  echo "  app: run.auth | run.human | run.cms | run.gpx | run.flash | run.mqtt"
  exit 1
fi

if [[ "$COMPONENT" != "nginx" && "$COMPONENT" != "webapp" && "$COMPONENT" != "app" && "$COMPONENT" != "mosquitto" && "$COMPONENT" != "meshtk" ]]; then
  echo "ERROR: Invalid component '$COMPONENT'. Must be 'nginx', 'webapp', 'app', 'mosquitto', or 'meshtk'"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" && "$APP" != "run.cms" && "$APP" != "run.gpx" && "$APP" != "run.flash" && "$APP" != "run.mqtt" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth', 'run.human', 'run.cms', 'run.gpx', 'run.flash', or 'run.mqtt'"
  exit 1
fi

# Validate component/app combinations
if [[ "$APP" == "run.cms" && "$COMPONENT" == "webapp" ]]; then
  echo "ERROR: run.cms uses 'app' component, not 'webapp'"
  exit 1
fi

if [[ "$APP" != "run.cms" && "$COMPONENT" == "app" ]]; then
  echo "ERROR: 'app' component is only valid for run.cms"
  exit 1
fi

if [[ "$APP" == "run.gpx" && "$COMPONENT" == "nginx" ]]; then
  echo "ERROR: run.gpx is a single-container app without nginx"
  exit 1
fi

# mqtt component/app validation
if [[ "$APP" == "run.mqtt" && "$COMPONENT" != "mosquitto" && "$COMPONENT" != "meshtk" && "$COMPONENT" != "nginx" ]]; then
  echo "ERROR: run.mqtt only accepts components 'mosquitto', 'meshtk', or 'nginx'"
  exit 1
fi

if [[ "$APP" != "run.mqtt" && ("$COMPONENT" == "mosquitto" || "$COMPONENT" == "meshtk") ]]; then
  echo "ERROR: '$COMPONENT' component is only valid for run.mqtt"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"

# run.mqtt lives at apps/mqtt/ (not apps/run.mqtt/)
if [[ "$APP" == "run.mqtt" ]]; then
  APP_DIR="${SCRIPT_DIR}/mqtt"
fi

VERSION_FILE="${APP_DIR}/${COMPONENT}/VERSION"

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
