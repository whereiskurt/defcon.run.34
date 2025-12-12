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

# Invalidate CloudFront cache
echo "=== Invalidating CloudFront cache ==="

# Map app name to CloudFront domain
case "$APP" in
  run.auth)
    CF_DOMAIN="auth.defcon.run"
    ;;
  run.human)
    CF_DOMAIN="run.defcon.run"
    ;;
esac

# Look up CloudFront distribution ID by alias
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[?@=='${CF_DOMAIN}']].Id" \
  --output text)

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "WARNING: Could not find CloudFront distribution for ${CF_DOMAIN}"
  echo "Skipping cache invalidation"
else
  echo "Found CloudFront distribution: ${DISTRIBUTION_ID} for ${CF_DOMAIN}"
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)
  echo "Created invalidation: ${INVALIDATION_ID}"
fi

echo "=== Release complete for ${APP} ==="
echo "$(date)"
