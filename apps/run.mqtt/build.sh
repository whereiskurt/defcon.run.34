#!/bin/bash
# Build MQTT container images locally
# Usage: ./build.sh <component|all>
# Components: mosquitto, meshtk, nginx, all
#
# This is a Phase 15 local build script.
# Phase 16 integrates into apps/build.sh + apps/deploy.sh for ECR push.

set -e

COMPONENT="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve meshtk source — copy from symlink target if needed
resolve_meshtk() {
  local meshtk_dir="${SCRIPT_DIR}/meshtk"
  if [[ -L "$meshtk_dir" ]]; then
    local target
    target=$(readlink "$meshtk_dir")
    echo "[build] Copying meshtk source from $target..."
    rm "$meshtk_dir"
    cp -r "$target" "$meshtk_dir"
    trap "rm -rf '$meshtk_dir' && ln -s '$target' '$meshtk_dir'" EXIT
  fi
}

build_mosquitto() {
  echo "=== Building mqtt-mosquitto ==="
  docker buildx build --load --platform linux/amd64 \
    -f "${SCRIPT_DIR}/mosquitto/Dockerfile.mosquitto" \
    -t mqtt-mosquitto:local \
    "${SCRIPT_DIR}/mosquitto/"
  echo "=== mqtt-mosquitto:local built ==="
}

build_meshtk() {
  echo "=== Building mqtt-meshtk ==="
  resolve_meshtk
  docker buildx build --load --platform linux/amd64 \
    -f "${SCRIPT_DIR}/meshtk/Dockerfile.meshtk" \
    -t mqtt-meshtk:local \
    "${SCRIPT_DIR}/meshtk/"
  echo "=== mqtt-meshtk:local built ==="
}

build_nginx() {
  echo "=== Building mqtt-nginx ==="
  resolve_meshtk
  docker buildx build --load --platform linux/amd64 \
    -f "${SCRIPT_DIR}/nginx/Dockerfile.nginx" \
    -t mqtt-nginx:local \
    "${SCRIPT_DIR}/"
  echo "=== mqtt-nginx:local built ==="
}

case "$COMPONENT" in
  mosquitto)
    build_mosquitto
    ;;
  meshtk)
    build_meshtk
    ;;
  nginx)
    build_nginx
    ;;
  all)
    build_mosquitto
    build_meshtk
    build_nginx
    ;;
  *)
    echo "Usage: ./build.sh <mosquitto|meshtk|nginx|all>"
    exit 1
    ;;
esac
