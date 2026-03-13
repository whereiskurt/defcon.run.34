#!/bin/bash
# Copies VERSION files to terraform and applies to trigger ECS blue/green deployment
# Usage: ./deploy.sh <app>
# Examples:
#   ./deploy.sh run.auth
#   ./deploy.sh run.human
#   ./deploy.sh run.cms
#   ./deploy.sh run.mqtt

set -e

APP="${1}"

if [[ -z "$APP" ]]; then
  echo "Usage: ./deploy.sh <app>"
  echo "  app: run.auth | run.human | run.cms | run.gpx | run.flash | run.mqtt"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" && "$APP" != "run.cms" && "$APP" != "run.gpx" && "$APP" != "run.flash" && "$APP" != "run.mqtt" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth', 'run.human', 'run.cms', 'run.gpx', 'run.flash', or 'run.mqtt'"
  exit 1
fi

# Set app-specific terraform service path and app component directory
case "$APP" in
  "run.auth")
    TF_SERVICE="run.auth"
    APP_COMPONENT="webapp"
    ;;
  "run.human")
    TF_SERVICE="run.human"
    APP_COMPONENT="webapp"
    ;;
  "run.cms")
    TF_SERVICE="run.cms"
    APP_COMPONENT="app"
    ;;
  "run.gpx")
    TF_SERVICE="run.gpx"
    APP_COMPONENT="webapp"
    ;;
  "run.flash")
    TF_SERVICE="run.flash"
    APP_COMPONENT="webapp"
    ;;
  "run.mqtt")
    TF_SERVICE="run.mqtt"
    APP_COMPONENT="mqtt"
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"
TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

echo "=== Deploying ${APP} ==="
echo "$(date)"

# Copy VERSION files to terraform
if [[ "$APP" == "run.mqtt" ]]; then
  # mqtt has 3 independent container images with separate VERSION files
  cp "${APP_DIR}/mosquitto/VERSION" "${TF_SERVICE_DIR}/VERSION.mosquitto"
  cp "${APP_DIR}/meshtk/VERSION" "${TF_SERVICE_DIR}/VERSION.meshtk"
  cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
else
  # Standard apps: optional nginx + single app/webapp VERSION
  if [[ -f "${APP_DIR}/nginx/VERSION" ]]; then
    cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
  fi
  cp "${APP_DIR}/${APP_COMPONENT}/VERSION" "${TF_SERVICE_DIR}/VERSION.app"
fi

# Apply terraform to trigger ECS blue/green deployment
# Only apply ECS modules (ecs-task then ecs-service) - not all infrastructure
echo "=== Applying Terraform (triggering ECS deployment) ==="
SITE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site"

echo "--- Applying ecs-task (register new task definitions) ---"
cd "${SITE_DIR}/ecs-task"
terragrunt apply --non-interactive

echo "--- Applying ecs-service (update services with new task definitions) ---"
cd "${SITE_DIR}/ecs-service"
terragrunt apply --non-interactive

cd -

echo "=== Deploy complete for ${APP} ==="
echo "$(date)"
