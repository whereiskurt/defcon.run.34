#!/bin/bash
# Copies VERSION files to terraform and applies to trigger ECS blue/green deployment
# Usage: ./deploy.sh <app>
# Examples:
#   ./deploy.sh run.auth
#   ./deploy.sh run.human

set -e

APP="${1}"

if [[ -z "$APP" ]]; then
  echo "Usage: ./deploy.sh <app>"
  echo "  app: run.auth | run.human"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth' or 'run.human'"
  exit 1
fi

# Set app-specific terraform service path
case "$APP" in
  "run.auth")
    TF_SERVICE="auth"
    ;;
  "run.human")
    TF_SERVICE="run-human"
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"
TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

echo "=== Deploying ${APP} ==="
echo "$(date)"

# Copy VERSION files to terraform
cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
cp "${APP_DIR}/webapp/VERSION" "${TF_SERVICE_DIR}/VERSION.app"

# Apply terraform to trigger ECS blue/green deployment
echo "=== Applying Terraform (triggering ECS deployment) ==="
cd "${SCRIPT_DIR}/../infra/terraform/live/site"
terragrunt run-all apply --terragrunt-non-interactive -auto-approve
cd -

echo "=== Deploy complete for ${APP} ==="
echo "$(date)"
