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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/${APP}"

if [[ "$COMPONENT" == "nginx" ]]; then
  # Deploy nginx
  export REPO_NAME="${REPO_PREFIX}-nginx"
  export IMAGE_TAG=${IMAGE_TAG:-$(cat "${APP_DIR}/nginx/VERSION" | tr -d '[:space:]')}

  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

  docker buildx build \
    --platform linux/amd64 \
    -f "${APP_DIR}/nginx/Dockerfile.nginx" -t "$REPO_NAME:$IMAGE_TAG" "${APP_DIR}/nginx/"

  docker tag "${REPO_NAME}:${IMAGE_TAG}" \
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

  # Build Docker image (amd64 for ECS)
  docker buildx build --platform=linux/amd64 \
    --build-arg NEXT_PUBLIC_ASSET_PREFIX="/${WEBAPP_PREFIX}/public" \
    --build-arg WEBAPP_PREFIX="${WEBAPP_PREFIX}" \
    --build-arg WEBAPP_ORIGIN="${WEBAPP_ORIGIN}" \
    --build-arg VERSION_NGINX="${VERSION_NGINX}" \
    --build-arg VERSION_WEBAPP="${VERSION_WEBAPP}" \
    -t "$REPO_NAME:$IMAGE_TAG" -f "${APP_DIR}/webapp/Dockerfile.webapp" "${APP_DIR}/webapp/"

  # Extract static assets from Docker image and sync to S3
  CONTAINER_ID=$(docker create "$REPO_NAME:$IMAGE_TAG")
  rm -rf /tmp/next-static /tmp/next-public
  docker cp "$CONTAINER_ID:/app/.next/static" /tmp/next-static
  docker cp "$CONTAINER_ID:/app/.next/server/app/index.html" /tmp/next-static
  docker cp "$CONTAINER_ID:/app/public" /tmp/next-public
  docker rm "$CONTAINER_ID"

  AWS_PROFILE=application aws s3 sync /tmp/next-static "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/_next/static" --cache-control 'public,max-age=31536000,immutable' --delete --exclude '*.map'
  AWS_PROFILE=application aws s3 cp /tmp/next-static/index.html "s3://${WEBAPP_ORIGIN_BUCKET}/index.html" --cache-control 'public,max-age=31536000,immutable'
  AWS_PROFILE=application aws s3 sync /tmp/next-public "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public" --cache-control 'public,max-age=31536000,immutable' --delete

  aws ecr get-login-password --region "${AWS_REGION}" \
    | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

  docker tag "${REPO_NAME}:${IMAGE_TAG}" \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  echo "Image successfully pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"
fi
