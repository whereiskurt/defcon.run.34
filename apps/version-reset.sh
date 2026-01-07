#!/bin/bash
# Resets VERSION files to v0.0.0
# Usage: ./version-reset.sh [--all | <component> <app>]
# Examples:
#   ./version-reset.sh --all              # Reset all VERSION files
#   ./version-reset.sh nginx run.auth     # Reset specific component
#   ./version-reset.sh webapp run.human
#   ./version-reset.sh app run.cms

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESET_VERSION="v0.0.0"

# All valid app/component combinations
declare -A APP_COMPONENTS=(
  ["run.auth"]="nginx webapp"
  ["run.human"]="nginx webapp"
  ["run.cms"]="nginx app"
)

reset_version_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local current=$(cat "$file" | tr -d '[:space:]')
    echo "$RESET_VERSION" > "$file"
    echo "Reset $file: $current -> $RESET_VERSION"
  else
    echo "SKIP: $file (not found)"
  fi
}

reset_all() {
  echo "Resetting all VERSION files to $RESET_VERSION..."
  echo ""

  for app in "${!APP_COMPONENTS[@]}"; do
    for component in ${APP_COMPONENTS[$app]}; do
      reset_version_file "${SCRIPT_DIR}/${app}/${component}/VERSION"
    done
  done

  echo ""
  echo "Done. All VERSION files reset to $RESET_VERSION"
}

reset_single() {
  local component="$1"
  local app="$2"

  if [[ -z "$component" || -z "$app" ]]; then
    echo "Usage: ./version-reset.sh [--all | <component> <app>]"
    echo "  --all: Reset all VERSION files"
    echo "  component: nginx | webapp | app"
    echo "  app: run.auth | run.human | run.cms"
    exit 1
  fi

  if [[ "$component" != "nginx" && "$component" != "webapp" && "$component" != "app" ]]; then
    echo "ERROR: Invalid component '$component'. Must be 'nginx', 'webapp', or 'app'"
    exit 1
  fi

  if [[ "$app" != "run.auth" && "$app" != "run.human" && "$app" != "run.cms" ]]; then
    echo "ERROR: Invalid app '$app'. Must be 'run.auth', 'run.human', or 'run.cms'"
    exit 1
  fi

  # Validate component/app combinations
  if [[ "$app" == "run.cms" && "$component" == "webapp" ]]; then
    echo "ERROR: run.cms uses 'app' component, not 'webapp'"
    exit 1
  fi

  if [[ "$app" != "run.cms" && "$component" == "app" ]]; then
    echo "ERROR: 'app' component is only valid for run.cms"
    exit 1
  fi

  local version_file="${SCRIPT_DIR}/${app}/${component}/VERSION"
  reset_version_file "$version_file"
}

# Main
if [[ "$1" == "--all" ]]; then
  reset_all
else
  reset_single "$1" "$2"
fi