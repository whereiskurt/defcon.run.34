#!/bin/bash
# Builds Docker image and pushes to ECR
# Usage: ./build.sh <component> <app>
# Examples:
#   ./build.sh nginx run.auth
#   ./build.sh webapp run.auth
#   ./build.sh nginx run.human
#   ./build.sh webapp run.human

set -e

COMPONENT="${1}"
APP="${2}"

if [[ -z "$COMPONENT" || -z "$APP" ]]; then
  echo "Usage: ./build.sh <component> <app>"
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

# Set app-specific variables
case "$APP" in
  "run.auth")
    REPO_PREFIX="dc34-auth"
    WEBAPP_ORIGIN="auth.defcon.run"
    SSM_PATH_SEGMENT="auth"
    ;;
  "run.human")
    REPO_PREFIX="dc34-run-human"
    WEBAPP_ORIGIN="run.defcon.run"
    SSM_PATH_SEGMENT="run"
    ;;
esac

# Common AWS setup
export PAGER=${PAGER:-}
export AWS_PROFILE=${AWS_PROFILE:-application}
export AWS_REGION=${AWS_REGION:-"us-east-1"}
export REGION_SHORT=${REGION_SHORT:-"use1"}
export AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}

echo "=== Build Config: AWS_REGION=${AWS_REGION}, REGION_SHORT=${REGION_SHORT} ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"

if [[ "$COMPONENT" == "nginx" ]]; then
  # Deploy nginx
  export REPO_NAME="${REPO_PREFIX}-nginx"
  export IMAGE_TAG=${IMAGE_TAG:-$(cat "${APP_DIR}/nginx/VERSION" | tr -d '[:space:]')}
  # Use region-specific local tag to avoid conflicts in parallel builds
  LOCAL_TAG="${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}"

  # Skip ECR login if already authenticated (e.g., in parallel builds)
  if [[ "${SKIP_ECR_LOGIN}" != "true" ]]; then
    aws ecr get-login-password --region "$AWS_REGION" \
      | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  fi

  docker buildx build \
    --platform linux/amd64 \
    -f "${APP_DIR}/nginx/Dockerfile.nginx" -t "$LOCAL_TAG" "${APP_DIR}/nginx/"

  docker tag "${LOCAL_TAG}" \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  echo "Image successfully pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

elif [[ "$COMPONENT" == "webapp" ]]; then
  # Deploy webapp
  export REPO_NAME="${REPO_PREFIX}-app"
  export IMAGE_TAG=${IMAGE_TAG:-$(cat "${APP_DIR}/webapp/VERSION" | tr -d '[:space:]')}
  export VERSION_NGINX=${VERSION_NGINX:-$(cat "${APP_DIR}/nginx/VERSION" | tr -d '[:space:]')}
  export VERSION_WEBAPP=${VERSION_WEBAPP:-$(cat "${APP_DIR}/webapp/VERSION" | tr -d '[:space:]')}
  export WEBAPP_PREFIX=${WEBAPP_PREFIX:-"${REGION_SHORT}/assets"}
  export WEBAPP_ORIGIN_BUCKET=$(aws ssm get-parameter --name "/dc34/cloudfront-assets/${REGION_SHORT}/${SSM_PATH_SEGMENT}/bucket_name" --region "${AWS_REGION}" --query "Parameter.Value" --output text)
  # Use region-specific local tag to avoid conflicts in parallel builds
  LOCAL_TAG="${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}"

  # Build Docker image (amd64 for ECS)
  docker buildx build --platform=linux/amd64 \
    --build-arg NEXT_PUBLIC_ASSET_PREFIX="/${WEBAPP_PREFIX}/public" \
    --build-arg WEBAPP_PREFIX="${WEBAPP_PREFIX}" \
    --build-arg WEBAPP_ORIGIN="${WEBAPP_ORIGIN}" \
    --build-arg VERSION_NGINX="${VERSION_NGINX}" \
    --build-arg VERSION_WEBAPP="${VERSION_WEBAPP}" \
    --build-arg REGION_SHORT="${REGION_SHORT}" \
    -t "$LOCAL_TAG" -f "${APP_DIR}/webapp/Dockerfile.webapp" "${APP_DIR}/webapp/"

  # Extract static assets from Docker image and sync to S3
  # Use unique temp dirs per app/region to avoid collisions in parallel builds
  TMP_DIR="/tmp/next-build-${REPO_NAME}-${REGION_SHORT}"
  TMP_STATIC="${TMP_DIR}/static"
  TMP_PUBLIC="${TMP_DIR}/public"

  CONTAINER_ID=$(docker create "$LOCAL_TAG")
  rm -rf "${TMP_DIR}"
  mkdir -p "${TMP_DIR}"
  docker cp "$CONTAINER_ID:/app/.next/static" "${TMP_STATIC}"
  docker cp "$CONTAINER_ID:/app/.next/server/app/index.html" "${TMP_STATIC}"
  docker cp "$CONTAINER_ID:/app/public" "${TMP_PUBLIC}"
  docker rm "$CONTAINER_ID"

  AWS_PROFILE=application aws s3 sync "${TMP_STATIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/_next/static" --cache-control 'public,max-age=31536000,immutable' --delete --exclude '*.map'
  AWS_PROFILE=application aws s3 cp "${TMP_STATIC}/index.html" "s3://${WEBAPP_ORIGIN_BUCKET}/index.html" --cache-control 'public,max-age=31536000,immutable'
  AWS_PROFILE=application aws s3 sync "${TMP_PUBLIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public" --cache-control 'public,max-age=31536000,immutable' --delete

  # Cleanup temp dir
  rm -rf "${TMP_DIR}"

  # Skip ECR login if already authenticated (e.g., in parallel builds)
  if [[ "${SKIP_ECR_LOGIN}" != "true" ]]; then
    aws ecr get-login-password --region "${AWS_REGION}" \
      | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  fi

  docker tag "${LOCAL_TAG}" \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  echo "Image successfully pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"
fi
