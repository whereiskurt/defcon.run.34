#!/bin/bash
# Smart multi-region release pipeline - only releases apps with version changes
# Compares app VERSION files with deployed VERSION files and skips unchanged apps
#
# Usage: ./release-changed.sh [options]
# Options:
#   --apps <apps>       Comma-separated list of apps to check (default: run.auth,run.human)
#   --regions <regions> Comma-separated list of regions (default: use1,cac1)
#   --skip-build        Skip building (use existing images)
#   --skip-deploy       Skip deployment (just build)
#   --parallel          Run regional builds in parallel (faster but harder to debug)
#   --dry-run           Show what would be released without actually doing it
#
# Examples:
#   ./release-changed.sh                    # Release only apps with version changes
#   ./release-changed.sh --apps run.auth    # Check only run.auth for changes
#   ./release-changed.sh --dry-run          # Preview what would be released

set -e

# Default configuration
APPS="run.auth,run.human"
REGIONS="use1,cac1"
SKIP_BUILD=false
SKIP_DEPLOY=false
PARALLEL=false
DRY_RUN=false

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
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    --parallel)
      PARALLEL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      head -16 "$0" | tail -14
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
    *) echo "" ;;
  esac
}

get_tf_service() {
  case "$1" in
    run.auth) echo "auth" ;;
    run.human) echo "run-human" ;;
    *) echo "" ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validate apps
for APP in "${APP_LIST[@]}"; do
  if [[ "$APP" != "run.auth" && "$APP" != "run.human" ]]; then
    echo "ERROR: Invalid app '$APP'. Must be 'run.auth' or 'run.human'"
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
echo "  SMART RELEASE (VERSION CHECK)"
echo "=============================================="
echo "Checking: ${APP_LIST[*]}"
echo "Regions:  ${REGION_LIST[*]}"
echo "Dry run:  $DRY_RUN"
echo "=============================================="
echo ""

#=============================================================================
# PHASE 0: Check versions and determine what needs to be released
#=============================================================================
echo "=============================================="
echo "  PHASE 0: VERSION CHECK"
echo "=============================================="

APPS_TO_RELEASE=()
NGINX_CHANGED=()
WEBAPP_CHANGED=()

for APP in "${APP_LIST[@]}"; do
  TF_SERVICE=$(get_tf_service "$APP")
  APP_DIR="${SCRIPT_DIR}/${APP}"
  TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

  # Get current app versions
  APP_NGINX_VERSION=$(cat "${APP_DIR}/nginx/VERSION" 2>/dev/null | tr -d '[:space:]')
  APP_WEBAPP_VERSION=$(cat "${APP_DIR}/webapp/VERSION" 2>/dev/null | tr -d '[:space:]')

  # Get deployed versions
  DEPLOYED_NGINX_VERSION=$(cat "${TF_SERVICE_DIR}/VERSION.nginx" 2>/dev/null | tr -d '[:space:]')
  DEPLOYED_WEBAPP_VERSION=$(cat "${TF_SERVICE_DIR}/VERSION.app" 2>/dev/null | tr -d '[:space:]')

  echo ""
  echo "--- ${APP} ---"
  echo "  nginx:  app=${APP_NGINX_VERSION} deployed=${DEPLOYED_NGINX_VERSION}"
  echo "  webapp: app=${APP_WEBAPP_VERSION} deployed=${DEPLOYED_WEBAPP_VERSION}"

  NEEDS_RELEASE=false
  NGINX_CHANGE=false
  WEBAPP_CHANGE=false

  if [[ "$APP_NGINX_VERSION" != "$DEPLOYED_NGINX_VERSION" ]]; then
    echo "  -> nginx VERSION changed"
    NEEDS_RELEASE=true
    NGINX_CHANGE=true
  fi

  if [[ "$APP_WEBAPP_VERSION" != "$DEPLOYED_WEBAPP_VERSION" ]]; then
    echo "  -> webapp VERSION changed"
    NEEDS_RELEASE=true
    WEBAPP_CHANGE=true
  fi

  if [[ "$NEEDS_RELEASE" == "true" ]]; then
    APPS_TO_RELEASE+=("$APP")
    if [[ "$NGINX_CHANGE" == "true" ]]; then
      NGINX_CHANGED+=("$APP")
    fi
    if [[ "$WEBAPP_CHANGE" == "true" ]]; then
      WEBAPP_CHANGED+=("$APP")
    fi
  else
    echo "  -> SKIPPING (no version changes)"
  fi
done

echo ""
echo "=============================================="

if [[ ${#APPS_TO_RELEASE[@]} -eq 0 ]]; then
  echo "No apps need to be released - all versions match!"
  echo "=============================================="
  exit 0
fi

echo "Apps to release: ${APPS_TO_RELEASE[*]}"
echo "=============================================="

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "DRY RUN - Would release the following:"
  for APP in "${APPS_TO_RELEASE[@]}"; do
    echo "  - ${APP}"
  done
  echo ""
  echo "Run without --dry-run to perform the release."
  exit 0
fi

echo ""
echo "Started: $(date)"

# Track timing
START_TIME=$(date +%s)

#=============================================================================
# PHASE 1: Build Images (per app, per region) - only for changed apps
#=============================================================================
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 1: BUILD & PUSH IMAGES"
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
    BUILD_STATUS_DIR="/tmp/release-changed-$$"
    rm -rf "${BUILD_STATUS_DIR}"
    mkdir -p "${BUILD_STATUS_DIR}"

    for APP in "${APPS_TO_RELEASE[@]}"; do
      for REGION in "${REGION_LIST[@]}"; do
        # Resolve values before spawning subshell (functions don't export in bash 3.2)
        _AWS_REGION=$(get_aws_region "$REGION")
        _REGION_DISPLAY=$(get_region_name "$REGION")

        # Check if this app needs nginx/webapp builds
        BUILD_NGINX=false
        BUILD_WEBAPP=false
        for changed_app in "${NGINX_CHANGED[@]}"; do
          if [[ "$changed_app" == "$APP" ]]; then
            BUILD_NGINX=true
            break
          fi
        done
        for changed_app in "${WEBAPP_CHANGED[@]}"; do
          if [[ "$changed_app" == "$APP" ]]; then
            BUILD_WEBAPP=true
            break
          fi
        done

        (
          # Disable set -e in subshell to handle errors explicitly
          set +e

          echo ""
          echo ">>> Building ${APP} for ${_REGION_DISPLAY} (${_AWS_REGION}) <<<"

          export AWS_REGION="${_AWS_REGION}"
          export REGION_SHORT="${REGION}"
          export SKIP_ECR_LOGIN="true"  # Already authenticated above

          if [[ "$BUILD_NGINX" == "true" ]]; then
            echo "  Building nginx..."
            if ! "${SCRIPT_DIR}/build.sh" nginx "$APP"; then
              echo "FAILED: nginx build for ${APP} in ${REGION}"
              echo "nginx" > "${BUILD_STATUS_DIR}/${APP}-${REGION}.failed"
              exit 1
            fi
          else
            echo "  Skipping nginx (no version change)"
          fi

          if [[ "$BUILD_WEBAPP" == "true" ]]; then
            echo "  Building webapp..."
            if ! "${SCRIPT_DIR}/build.sh" webapp "$APP"; then
              echo "FAILED: webapp build for ${APP} in ${REGION}"
              echo "webapp" > "${BUILD_STATUS_DIR}/${APP}-${REGION}.failed"
              exit 1
            fi
          else
            echo "  Skipping webapp (no version change)"
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
    for APP in "${APPS_TO_RELEASE[@]}"; do
      # Check if this app needs nginx/webapp builds
      BUILD_NGINX=false
      BUILD_WEBAPP=false
      for changed_app in "${NGINX_CHANGED[@]}"; do
        if [[ "$changed_app" == "$APP" ]]; then
          BUILD_NGINX=true
          break
        fi
      done
      for changed_app in "${WEBAPP_CHANGED[@]}"; do
        if [[ "$changed_app" == "$APP" ]]; then
          BUILD_WEBAPP=true
          break
        fi
      done

      for REGION in "${REGION_LIST[@]}"; do
        _AWS_REGION=$(get_aws_region "$REGION")
        _REGION_DISPLAY=$(get_region_name "$REGION")

        echo ""
        echo ">>> Building ${APP} for ${_REGION_DISPLAY} (${_AWS_REGION}) <<<"

        export AWS_REGION="${_AWS_REGION}"
        export REGION_SHORT="${REGION}"

        if [[ "$BUILD_NGINX" == "true" ]]; then
          echo "  Building nginx..."
          "${SCRIPT_DIR}/build.sh" nginx "$APP"
        else
          echo "  Skipping nginx (no version change)"
        fi

        if [[ "$BUILD_WEBAPP" == "true" ]]; then
          echo "  Building webapp..."
          "${SCRIPT_DIR}/build.sh" webapp "$APP"
        else
          echo "  Skipping webapp (no version change)"
        fi

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
# PHASE 2: Deploy to ECS (all regions handled by terragrunt run-all)
#=============================================================================
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 2: DEPLOY TO ECS"
  echo "=============================================="

  # Copy VERSION files for apps being released
  for APP in "${APPS_TO_RELEASE[@]}"; do
    TF_SERVICE=$(get_tf_service "$APP")
    APP_DIR="${SCRIPT_DIR}/${APP}"
    TF_SERVICE_DIR="${SCRIPT_DIR}/../infra/terraform/live/site/services/${TF_SERVICE}"

    echo ""
    echo "--- Copying VERSION files for ${APP} ---"
    cp "${APP_DIR}/nginx/VERSION" "${TF_SERVICE_DIR}/VERSION.nginx"
    cp "${APP_DIR}/webapp/VERSION" "${TF_SERVICE_DIR}/VERSION.app"
    echo "  VERSION.nginx: $(cat "${TF_SERVICE_DIR}/VERSION.nginx")"
    echo "  VERSION.app:   $(cat "${TF_SERVICE_DIR}/VERSION.app")"
  done

  # Deploy all regions in one terragrunt run-all (handles all regions by design)
  echo ""
  echo ">>> Deploying to all regions via terragrunt run-all <<<"
  cd "${SCRIPT_DIR}/../infra/terraform/live/site"
  terragrunt run-all apply --terragrunt-non-interactive -auto-approve
  cd - > /dev/null

  echo ""
  echo "All deployments complete!"
else
  echo ""
  echo "--- Skipping deploy (--skip-deploy) ---"
fi

#=============================================================================
# PHASE 3: CloudFront Invalidation (once per app)
#=============================================================================
if [[ "$SKIP_DEPLOY" == "false" ]]; then
  echo ""
  echo "=============================================="
  echo "  PHASE 3: CLOUDFRONT INVALIDATION"
  echo "=============================================="

  for APP in "${APPS_TO_RELEASE[@]}"; do
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
echo "Released: ${APPS_TO_RELEASE[*]}"
echo "Regions:  ${REGION_LIST[*]}"
echo "Duration: ${MINUTES}m ${SECONDS}s"
echo "Finished: $(date)"
echo "=============================================="
