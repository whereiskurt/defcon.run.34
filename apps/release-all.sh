#!/bin/bash
# Full multi-region release pipeline for all apps
# Bumps versions once, builds images for each region, deploys to both regions
#
# Usage: ./release-all.sh [options]
# Options:
#   --apps <apps>       Comma-separated list of apps (default: run.auth,run.human)
#   --regions <regions> Comma-separated list of regions (default: use1,cac1)
#   --skip-bump         Skip version bumping (use existing versions)
#   --skip-build        Skip building (use existing images)
#   --skip-deploy       Skip deployment (just build)
#   --skip-nginx        Skip nginx container builds (only build app/webapp)
#   --parallel          Run regional builds in parallel (faster but harder to debug)
#   --no-branch         Don't create a release branch (commit to current branch)
#   --push              Push the release branch after committing
#
# Examples:
#   ./release-all.sh                           # Full release: both apps, both regions
#   ./release-all.sh --apps run.auth           # Only run.auth, both regions
#   ./release-all.sh --apps run.cms            # Only run.cms (CMS has different build)
#   ./release-all.sh --regions use1            # Both apps, only us-east-1
#   ./release-all.sh --skip-bump --skip-build  # Deploy only (use existing images)

set -e

# Default configuration
APPS="run.auth,run.human,run.cms,run.gpx"
# REGIONS="use1,cac1"
REGIONS="use1"
SKIP_BUMP=false
SKIP_BUILD=false
SKIP_DEPLOY=false
SKIP_NGINX=false
PARALLEL=false
CREATE_BRANCH=true
PUSH_BRANCH=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --apps)
      APPS="$2"
      shift 2
      ;;
    --regions)
      REGIONS="$2"
      shift 2
      ;;
    --skip-bump)
      SKIP_BUMP=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    --skip-nginx)
      SKIP_NGINX=true
      shift
      ;;
    --parallel)
      PARALLEL=true
      shift
      ;;
    --no-branch)
      CREATE_BRANCH=false
      shift
      ;;
    --push)
      PUSH_BRANCH=true
      shift
      ;;
    --help|-h)
      head -20 "$0" | tail -18
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option $1"
      exit 1
      ;;
  esac
done

# Convert comma-separated to arrays
IFS=',' read -ra APP_LIST <<< "$APPS"
IFS=',' read -ra REGION_LIST <<< "$REGIONS"

# Helper functions for lookups (Bash 3.2 compatible - no associative arrays)
get_aws_region() {
  case "$1" in
    use1) echo "us-east-1" ;;
    cac1) echo "ca-central-1" ;;
    *) echo "" ;;
  esac
}

get_region_name() {
  case "$1" in
    use1) echo "US East (N. Virginia)" ;;
    cac1) echo "Canada (Central)" ;;
    *) echo "$1" ;;
  esac
}

get_cf_domain() {
  case "$1" in
    run.auth) echo "auth.defcon.run" ;;
    run.human) echo "run.defcon.run" ;;
    run.cms) echo "cms.defcon.run" ;;
    run.gpx) echo "gpx.defcon.run" ;;
    *) echo "" ;;
  esac
}

get_tf_service() {
  case "$1" in
    run.auth) echo "run-auth" ;;
    run.human) echo "run-human" ;;
    run.cms) echo "run-cms" ;;
    run.gpx) echo "run-gpx" ;;
    *) echo "" ;;
  esac
}

# Check if app has nginx container (run.gpx is single container, no nginx)
has_nginx() {
  case "$1" in
    run.gpx) echo "false" ;;
    *) echo "true" ;;
  esac
}

# Get the app component for building (webapp vs app)
get_app_component() {
  case "$1" in
    run.cms) echo "app" ;;
    *) echo "webapp" ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validate apps
for APP in "${APP_LIST[@]}"; do
  if [[ "$APP" != "run.auth" && "$APP" != "run.human" && "$APP" != "run.cms" && "$APP" != "run.gpx" ]]; then
    echo "ERROR: Invalid app '$APP'. Must be 'run.auth', 'run.human', 'run.cms', or 'run.gpx'"
    exit 1
  fi
done

# Validate regions
for REGION in "${REGION_LIST[@]}"; do
  AWS_REGION=$(get_aws_region "$REGION")
  if [[ -z "$AWS_REGION" ]]; then
    echo "ERROR: Invalid region '$REGION'. Must be 'use1' or 'cac1'"
    exit 1
  fi
done

echo "=============================================="
echo "  MULTI-REGION RELEASE"
echo "=============================================="
echo "Apps:    ${APP_LIST[*]}"
echo "Regions: ${REGION_LIST[*]}"
echo "Skip bump:  $SKIP_BUMP"
echo "Skip build: $SKIP_BUILD"
echo "Skip deploy: $SKIP_DEPLOY"
echo "Skip nginx: $SKIP_NGINX"
echo "Parallel:   $PARALLEL"
echo "Create branch: $CREATE_BRANCH"
echo "Push branch: $PUSH_BRANCH"
echo "=============================================="
echo "Started: $(date)"
echo ""

# Track timing
START_TIME=$(date +%s)

#=============================================================================
# PHASE 1: Version Bump (once per app, shared across regions)
#=============================================================================
if [[ "$SKIP_BUMP" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 1: VERSION BUMP"
  echo "=============================================="

  # Create release branch if requested
  if [[ "$CREATE_BRANCH" == "true" ]]; then
    RELEASE_BRANCH="release/$(date +%Y-%m-%d-%H%M%S)"
    echo ""
    echo "--- Creating release branch: ${RELEASE_BRANCH} ---"
    git checkout -b "$RELEASE_BRANCH"
    echo "  Branch created: ${RELEASE_BRANCH}"
  fi

  for APP in "${APP_LIST[@]}"; do
    echo ""
    echo "--- Bumping versions for ${APP} ---"
    APP_COMPONENT=$(get_app_component "$APP")
    APP_HAS_NGINX=$(has_nginx "$APP")
    if [[ "$SKIP_NGINX" == "false" && "$APP_HAS_NGINX" == "true" ]]; then
      "${SCRIPT_DIR}/version.sh" nginx "$APP"
    fi
    "${SCRIPT_DIR}/version.sh" "$APP_COMPONENT" "$APP"
  done

  echo ""
  echo "--- Committing VERSION bumps to git ---"
  # Collect all VERSION files that were bumped
  VERSION_FILES=()
  for APP in "${APP_LIST[@]}"; do
    APP_COMPONENT=$(get_app_component "$APP")
    APP_HAS_NGINX=$(has_nginx "$APP")
    if [[ "$SKIP_NGINX" == "false" && "$APP_HAS_NGINX" == "true" ]]; then
      VERSION_FILES+=("${SCRIPT_DIR}/${APP}/nginx/VERSION")
    fi
    VERSION_FILES+=("${SCRIPT_DIR}/${APP}/${APP_COMPONENT}/VERSION")
  done

  # Stage and commit VERSION files
  git add "${VERSION_FILES[@]}"
  if git diff --cached --quiet; then
    echo "  No VERSION changes to commit"
  else
    git commit -m "Bump versions for release: ${APP_LIST[*]}"
    echo "  VERSION bumps committed"
  fi

  # Push branch if requested
  if [[ "$PUSH_BRANCH" == "true" && "$CREATE_BRANCH" == "true" ]]; then
    echo ""
    echo "--- Pushing release branch ---"
    git push -u origin "$RELEASE_BRANCH"
    echo "  Branch pushed: ${RELEASE_BRANCH}"
  fi

  echo ""
  echo "Version bump complete!"
else
  echo ""
  echo "--- Skipping version bump (--skip-bump) ---"
fi

#=============================================================================
# PHASE 2: Build Images (per app, per region)
#=============================================================================
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 2: BUILD & PUSH IMAGES"
  echo "=============================================="

  if [[ "$PARALLEL" == "true" ]]; then
    # Parallel builds - uses region-specific local tags to avoid conflicts
    echo "Running builds in parallel..."

    # Login to ECR for all regions BEFORE parallel builds to avoid keychain race condition
    export AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}
    echo "Pre-authenticating to ECR for all regions..."
    for REGION in "${REGION_LIST[@]}"; do
      _AWS_REGION=$(get_aws_region "$REGION")
      echo "  Logging in to ECR in ${_AWS_REGION}..."
      aws ecr get-login-password --region "${_AWS_REGION}" \
        | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${_AWS_REGION}.amazonaws.com" 2>/dev/null
    done
    echo "ECR authentication complete."

    PIDS=()
    BUILD_STATUS_DIR="/tmp/release-all-$$"
    rm -rf "${BUILD_STATUS_DIR}"
    mkdir -p "${BUILD_STATUS_DIR}"

    for APP in "${APP_LIST[@]}"; do
      for REGION in "${REGION_LIST[@]}"; do
        # Resolve values before spawning subshell (functions don't export in bash 3.2)
        _AWS_REGION=$(get_aws_region "$REGION")
        _REGION_DISPLAY=$(get_region_name "$REGION")
        _APP_COMPONENT=$(get_app_component "$APP")
        _APP_HAS_NGINX=$(has_nginx "$APP")
        (
          # Disable set -e in subshell to handle errors explicitly
          set +e

          echo ""
          echo ">>> Building ${APP} for ${_REGION_DISPLAY} (${_AWS_REGION}) <<<"

          export AWS_REGION="${_AWS_REGION}"
          export REGION_SHORT="${REGION}"
          export SKIP_ECR_LOGIN="true"  # Already authenticated above

          if [[ "$SKIP_NGINX" == "false" && "$_APP_HAS_NGINX" == "true" ]]; then
            echo "  Building nginx..."
            if ! "${SCRIPT_DIR}/build.sh" nginx "$APP"; then
              echo "FAILED: nginx build for ${APP} in ${REGION}"
              echo "nginx" > "${BUILD_STATUS_DIR}/${APP}-${REGION}.failed"
              exit 1
            fi
          fi

          echo "  Building ${_APP_COMPONENT}..."
          if ! "${SCRIPT_DIR}/build.sh" "${_APP_COMPONENT}" "$APP"; then
            echo "FAILED: ${_APP_COMPONENT} build for ${APP} in ${REGION}"
            echo "${_APP_COMPONENT}" > "${BUILD_STATUS_DIR}/${APP}-${REGION}.failed"
            exit 1
          fi

          echo "  Build complete for ${APP} in ${REGION}"
          touch "${BUILD_STATUS_DIR}/${APP}-${REGION}.success"
        ) &
        PIDS+=($!)
      done
    done

    # Wait for all builds
    for PID in "${PIDS[@]}"; do
      wait "$PID" 2>/dev/null || true
    done

    # Check for failures
    FAILED_BUILDS=$(find "${BUILD_STATUS_DIR}" -name "*.failed" 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$FAILED_BUILDS" -gt 0 ]]; then
      echo ""
      echo "ERROR: ${FAILED_BUILDS} build(s) failed:"
      for f in "${BUILD_STATUS_DIR}"/*.failed; do
        if [[ -f "$f" ]]; then
          FAILED_NAME=$(basename "$f" .failed)
          FAILED_COMPONENT=$(cat "$f")
          echo "  - ${FAILED_NAME} (${FAILED_COMPONENT})"
        fi
      done
      rm -rf "${BUILD_STATUS_DIR}"
      exit 1
    fi

    rm -rf "${BUILD_STATUS_DIR}"
  else
    # Sequential builds (easier to debug)
    for APP in "${APP_LIST[@]}"; do
      for REGION in "${REGION_LIST[@]}"; do
        _AWS_REGION=$(get_aws_region "$REGION")
        _REGION_DISPLAY=$(get_region_name "$REGION")
        _APP_COMPONENT=$(get_app_component "$APP")
        _APP_HAS_NGINX=$(has_nginx "$APP")

        echo ""
        echo ">>> Building ${APP} for ${_REGION_DISPLAY} (${_AWS_REGION}) <<<"

        export AWS_REGION="${_AWS_REGION}"
        export REGION_SHORT="${REGION}"

        if [[ "$SKIP_NGINX" == "false" && "$_APP_HAS_NGINX" == "true" ]]; then
          echo "  Building nginx..."
          "${SCRIPT_DIR}/build.sh" nginx "$APP"
        fi

        echo "  Building ${_APP_COMPONENT}..."
        "${SCRIPT_DIR}/build.sh" "${_APP_COMPONENT}" "$APP"

        echo "  Build complete for ${APP} in ${REGION}"
      done
    done
  fi

  echo ""
  echo "All builds complete!"
else
  echo ""
  echo "--- Skipping build (--skip-build) ---"
fi

#=============================================================================
# PHASE 3: Deploy to ECS (targeted terragrunt apply on ecs-task and ecs-service)
#=============================================================================
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 3: DEPLOY TO ECS"
  echo "=============================================="

  # Copy VERSION files for all apps
  for APP in "${APP_LIST[@]}"; do
    TF_SERVICE=$(get_tf_service "$APP")
    APP_COMPONENT=$(get_app_component "$APP")
    APP_HAS_NGINX=$(has_nginx "$APP")
    APP_DIR="${SCRIPT_DIR}/${APP}"
    TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

    echo ""
    echo "--- Copying VERSION files for ${APP} ---"
    if [[ "$APP_HAS_NGINX" == "true" ]]; then
      cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
      echo "  VERSION.nginx: $(cat "${TF_SERVICE_DIR}/VERSION.nginx")"
    fi
    cp "${APP_DIR}/${APP_COMPONENT}/VERSION" "${TF_SERVICE_DIR}/VERSION.app"
    echo "  VERSION.app:   $(cat "${TF_SERVICE_DIR}/VERSION.app")"
  done

  # Commit terraform VERSION files
  echo ""
  echo "--- Committing terraform VERSION files to git ---"
  TF_SERVICES_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services"
  git add "${TF_SERVICES_DIR}"/*/VERSION.app "${TF_SERVICES_DIR}"/*/VERSION.nginx 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "  No terraform VERSION changes to commit"
  else
    git commit -m "Update terraform VERSION files for deploy: ${APP_LIST[*]}"
    echo "  Terraform VERSION files committed"
  fi

  # Deploy to each region - only ecs-task and ecs-service modules
  # (ecs-task creates new task definitions, ecs-service deploys them)
  TF_SITE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site"

  for REGION in "${REGION_LIST[@]}"; do
    _AWS_REGION=$(get_aws_region "$REGION")
    _REGION_DISPLAY=$(get_region_name "$REGION")
    REGION_DIR="${TF_SITE_DIR}/region/${_AWS_REGION}"

    echo ""
    echo ">>> Deploying to ${_REGION_DISPLAY} (${_AWS_REGION}) <<<"

    # Use run --all from region directory to properly handle dependency outputs
    # This ensures ecs-service sees the new task definition ARNs from ecs-task
    # Same approach as deploy.sh but scoped to the region directory
    echo "  Applying ecs-task and ecs-service..."
    (cd "${REGION_DIR}" && terragrunt run apply --all --non-interactive -- -auto-approve)

    echo "  Deploy complete for ${_REGION_DISPLAY}"
  done

  echo ""
  echo "All deployments complete!"
else
  echo ""
  echo "--- Skipping deploy (--skip-deploy) ---"
fi

#=============================================================================
# PHASE 4: CloudFront Invalidation (once per app)
#=============================================================================
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 4: CLOUDFRONT INVALIDATION"
  echo "=============================================="

  for APP in "${APP_LIST[@]}"; do
    CF_DOMAIN=$(get_cf_domain "$APP")

    echo ""
    echo "--- Invalidating cache for ${APP} (${CF_DOMAIN}) ---"

    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
      --query "DistributionList.Items[?Aliases.Items[?@=='${CF_DOMAIN}']].Id" \
      --output text 2>/dev/null || true)

    if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
      echo "  WARNING: Could not find CloudFront distribution for ${CF_DOMAIN}"
      echo "  Skipping cache invalidation"
    else
      echo "  Found distribution: ${DISTRIBUTION_ID}"
      INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text)
      echo "  Created invalidation: ${INVALIDATION_ID}"
    fi
  done
fi

#=============================================================================
# Summary
#=============================================================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "=============================================="
echo "  RELEASE COMPLETE"
echo "=============================================="
echo "Apps:     ${APP_LIST[*]}"
echo "Regions:  ${REGION_LIST[*]}"
echo "Duration: ${MINUTES}m ${SECONDS}s"
echo "Finished: $(date)"
echo "=============================================="
