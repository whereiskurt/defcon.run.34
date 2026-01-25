#!/bin/bash
# Builds Docker image and pushes to ECR
# Usage: ./build.sh <component> <app>
# Examples:
#   ./build.sh nginx run.auth
#   ./build.sh webapp run.auth
#   ./build.sh nginx run.human
#   ./build.sh webapp run.human
#   ./build.sh nginx run.cms
#   ./build.sh app run.cms

set -e

COMPONENT="${1}"
APP="${2}"

if [[ -z "$COMPONENT" || -z "$APP" ]]; then
  echo "Usage: ./build.sh <component> <app>"
  echo "  component: nginx | webapp | app"
  echo "  app: run.auth | run.human | run.cms | run.gpx"
  exit 1
fi

if [[ "$COMPONENT" != "nginx" && "$COMPONENT" != "webapp" && "$COMPONENT" != "app" ]]; then
  echo "ERROR: Invalid component '$COMPONENT'. Must be 'nginx', 'webapp', or 'app'"
  exit 1
fi

if [[ "$APP" != "run.auth" && "$APP" != "run.human" && "$APP" != "run.cms" && "$APP" != "run.gpx" ]]; then
  echo "ERROR: Invalid app '$APP'. Must be 'run.auth', 'run.human', 'run.cms', or 'run.gpx'"
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

# Set app-specific variables
case "$APP" in
  "run.auth")
    REPO_PREFIX="dc34-run-auth"
    WEBAPP_ORIGIN="auth.defcon.run"
    SSM_PATH_SEGMENT="auth"
    ;;
  "run.human")
    REPO_PREFIX="dc34-run-human"
    WEBAPP_ORIGIN="run.defcon.run"
    SSM_PATH_SEGMENT="run"
    ;;
  "run.cms")
    REPO_PREFIX="dc34-run-cms"
    ;;
  "run.gpx")
    REPO_PREFIX="dc34-run-gpx"
    WEBAPP_ORIGIN="gpx.defcon.run"
    SSM_PATH_SEGMENT="gpx"
    ;;
esac

# Common AWS setup
export PAGER=${PAGER:-}
# Only set AWS_PROFILE if not running in GitHub Actions (where OIDC provides credentials)
if [[ -z "$GITHUB_ACTIONS" ]]; then
  export AWS_PROFILE=${AWS_PROFILE:-application}
fi
export AWS_REGION=${AWS_REGION:-"us-east-1"}
export REGION_SHORT=${REGION_SHORT:-"use1"}
export AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}

# Helper function for AWS commands - uses profile locally, OIDC in CI
aws_cmd() {
  if [[ -z "$GITHUB_ACTIONS" ]]; then
    AWS_PROFILE=application aws "$@"
  else
    aws "$@"
  fi
}

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
  # Only read nginx VERSION for apps that have nginx (run.gpx is single container, no nginx)
  if [[ -f "${APP_DIR}/nginx/VERSION" ]]; then
    export VERSION_NGINX=${VERSION_NGINX:-$(cat "${APP_DIR}/nginx/VERSION" | tr -d '[:space:]')}
  else
    export VERSION_NGINX=${VERSION_NGINX:-"none"}
  fi
  export VERSION_WEBAPP=${VERSION_WEBAPP:-$(cat "${APP_DIR}/webapp/VERSION" | tr -d '[:space:]')}
  export WEBAPP_PREFIX=${WEBAPP_PREFIX:-"${REGION_SHORT}/assets"}
  export WEBAPP_ORIGIN_BUCKET=$(aws ssm get-parameter --name "/dc34/cloudfront-assets/${REGION_SHORT}/${SSM_PATH_SEGMENT}/bucket_name" --region "${AWS_REGION}" --query "Parameter.Value" --output text)
  # Use region-specific local tag to avoid conflicts in parallel builds
  LOCAL_TAG="${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}"

  # Build Docker image (amd64 for ECS)
  # run.gpx needs wider build context to include gpx-studio submodule
  if [[ "$APP" == "run.gpx" ]]; then
    BUILD_CONTEXT="${APP_DIR}"
    # Fetch Mapbox public token from SSM (used by gpx.studio at build time)
    PUBLIC_MAPBOX_TOKEN=$(aws ssm get-parameter --name "/dc34/secrets/${REGION_SHORT}/mapbox/public_token" --region "${AWS_REGION}" --query "Parameter.Value" --output text 2>/dev/null || echo "")
  else
    BUILD_CONTEXT="${APP_DIR}/webapp/"
    PUBLIC_MAPBOX_TOKEN=""
  fi
  docker buildx build --platform=linux/amd64 \
    --build-arg NEXT_PUBLIC_ASSET_PREFIX="/${WEBAPP_PREFIX}/public" \
    --build-arg WEBAPP_PREFIX="${WEBAPP_PREFIX}" \
    --build-arg WEBAPP_ORIGIN="${WEBAPP_ORIGIN}" \
    --build-arg VERSION_NGINX="${VERSION_NGINX}" \
    --build-arg VERSION_WEBAPP="${VERSION_WEBAPP}" \
    --build-arg REGION_SHORT="${REGION_SHORT}" \
    --build-arg PUBLIC_MAPBOX_TOKEN="${PUBLIC_MAPBOX_TOKEN}" \
    -t "$LOCAL_TAG" -f "${APP_DIR}/webapp/Dockerfile.webapp" "${BUILD_CONTEXT}"

  # Extract static assets from Docker image and sync to S3
  # Use unique temp dirs per app/region to avoid collisions in parallel builds
  TMP_DIR="/tmp/next-build-${REPO_NAME}-${REGION_SHORT}"
  TMP_STATIC="${TMP_DIR}/static"
  TMP_PUBLIC="${TMP_DIR}/public"

  CONTAINER_ID=$(docker create "$LOCAL_TAG")
  rm -rf "${TMP_DIR}"
  mkdir -p "${TMP_DIR}"
  docker cp "$CONTAINER_ID:/app/.next/static" "${TMP_STATIC}"
  # Copy index.html if it exists (depends on app structure - route groups may not generate root index.html)
  docker cp "$CONTAINER_ID:/app/.next/server/app/index.html" "${TMP_STATIC}" 2>/dev/null || true
  docker cp "$CONTAINER_ID:/app/public" "${TMP_PUBLIC}"
  docker rm "$CONTAINER_ID"

  aws_cmd s3 sync "${TMP_STATIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/_next/static" --cache-control 'public,max-age=31536000,immutable' --delete --exclude '*.map'

  # Upload custom root index.html (handles region routing via cookie)
  aws_cmd s3 cp "${APP_DIR}/index.html" "s3://${WEBAPP_ORIGIN_BUCKET}/index.html" --cache-control 'no-cache, no-store, must-revalidate'
  # Upload region-specific index.html:
  # - If Next.js generated one, use it (immutable cache)
  # - Otherwise, use redirect template to send /use1 -> /use1/ (no-cache since it's a redirect)
  # CloudFront Function rewrites /use1 -> /use1/index.html, so this file handles bare region paths
  REDIRECT_TEMPLATE="${APP_DIR}/redirects/region.html"
  if [[ -f "${TMP_STATIC}/index.html" ]]; then
    aws_cmd s3 cp "${TMP_STATIC}/index.html" "s3://${WEBAPP_ORIGIN_BUCKET}/${REGION_SHORT}/index.html" --cache-control 'public,max-age=31536000,immutable'
  elif [[ -f "${REDIRECT_TEMPLATE}" ]]; then
    TMP_REDIRECT="${TMP_DIR}/region-redirect.html"
    sed "s/{{REGION}}/${REGION_SHORT}/g" "${REDIRECT_TEMPLATE}" > "${TMP_REDIRECT}"
    aws_cmd s3 cp "${TMP_REDIRECT}" "s3://${WEBAPP_ORIGIN_BUCKET}/${REGION_SHORT}/index.html" --content-type 'text/html' --cache-control 'no-cache, no-store, must-revalidate'
  fi
  aws_cmd s3 cp "${TMP_PUBLIC}/favicon.ico" "s3://${WEBAPP_ORIGIN_BUCKET}/favicon.ico" --cache-control 'public,max-age=31536000,immutable'
  aws_cmd s3 cp "${TMP_PUBLIC}/favicon.ico" "s3://${WEBAPP_ORIGIN_BUCKET}/${REGION_SHORT}/favicon.ico" --cache-control 'public,max-age=31536000,immutable'
  aws_cmd s3 sync "${TMP_PUBLIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public" --cache-control 'public,max-age=31536000,immutable' --delete

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

elif [[ "$COMPONENT" == "app" ]]; then
  # Deploy CMS app (Strapi + Litestream - no static asset sync)
  export REPO_NAME="${REPO_PREFIX}-app"
  export IMAGE_TAG=${IMAGE_TAG:-$(cat "${APP_DIR}/app/VERSION" | tr -d '[:space:]')}
  # Use region-specific local tag to avoid conflicts in parallel builds
  LOCAL_TAG="${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}"

  # Skip ECR login if already authenticated (e.g., in parallel builds)
  if [[ "${SKIP_ECR_LOGIN}" != "true" ]]; then
    aws ecr get-login-password --region "${AWS_REGION}" \
      | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  fi

  # Build Docker image (amd64 for ECS)
  # --no-cache ensures native modules (better-sqlite3) are compiled fresh for amd64
  # REGION_SHORT is passed to set Vite base path for admin assets (e.g., /use1/admin/)
  docker buildx build --platform=linux/amd64 --no-cache \
    --build-arg REGION_SHORT="${REGION_SHORT}" \
    -t "$LOCAL_TAG" -f "${APP_DIR}/app/Dockerfile.app" "${APP_DIR}/app/"

  docker tag "${LOCAL_TAG}" \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

  echo "Image successfully pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"
fi
