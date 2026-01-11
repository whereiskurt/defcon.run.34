#!/bin/bash
# Copies VERSION files to terraform and applies to trigger ECS blue/green deployment
# Usage: ./deploy.sh <app>
# Examples:
#   ./deploy.sh run.auth
#   ./deploy.sh run.human
#   ./deploy.sh run.cms

set -e

APP="${1}"

if [[ -z "$APP" ]]; then
  echo "Usage: ./deploy.sh <app>"
  echo "  app: run.auth | run.human | run.cms | run.gpx"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" && "$APP" != "run.cms" && "$APP" != "run.gpx" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth', 'run.human', 'run.cms', or 'run.gpx'"
  exit 1
fi

# Set app-specific terraform service path and app component directory
case "$APP" in
  "run.auth")
    TF_SERVICE="auth"
    APP_COMPONENT="webapp"
    ;;
  "run.human")
    TF_SERVICE="run-human"
    APP_COMPONENT="webapp"
    ;;
  "run.cms")
    TF_SERVICE="cms"
    APP_COMPONENT="app"
    ;;
  "run.gpx")
    TF_SERVICE="run-gpx"
    APP_COMPONENT="webapp"
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"
TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

echo "=== Deploying ${APP} ==="
echo "$(date)"

# Copy VERSION files to terraform
# Some apps (like run.gpx) don't have nginx component
if [[ -f "${APP_DIR}/nginx/VERSION" ]]; then
  cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
fi
cp "${APP_DIR}/${APP_COMPONENT}/VERSION" "${TF_SERVICE_DIR}/VERSION.app"

# Apply terraform to trigger ECS blue/green deployment
echo "=== Applying Terraform (triggering ECS deployment) ==="
cd "${SCRIPT_DIR}/../infra/terraform/live/site"
terragrunt run apply --all --non-interactive
cd -

echo "=== Deploy complete for ${APP} ==="
echo "$(date)"
