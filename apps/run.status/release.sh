#!/usr/bin/env bash
#
# release.sh — publish the static status site to its S3 origin and invalidate CloudFront.
#
# No ECS, no build step. Just: stamp the timestamp, sync ./site → s3://<bucket>/<prefix>/,
# then invalidate the CDN so the change is live within the short cache window.
#
# Usage:
#   ./release.sh                # publish everything
#   ./release.sh --status-only  # publish only status.json + marquee.json (fast content update)
#   ./release.sh --no-stamp     # don't rewrite the "updated" timestamp in status.json
#
set -euo pipefail

PROFILE="${AWS_PROFILE:-dc34-application}"
SITE_LABEL="${SITE_LABEL:-dc34}"
REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/site"

STATUS_ONLY=false
STAMP=true
for arg in "$@"; do
  case "$arg" in
    --status-only) STATUS_ONLY=true ;;
    --no-stamp)    STAMP=false ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "▚ status.defcon.run release  (profile=${PROFILE})"

# --- discover the bucket / distribution / prefix from SSM (published by terraform) ---
ssm() { aws ssm get-parameter --name "$1" --query 'Parameter.Value' --output text --profile "$PROFILE" --region "$REGION"; }
BUCKET="$(ssm "/${SITE_LABEL}/status-site/bucket")"
DIST_ID="$(ssm "/${SITE_LABEL}/status-site/distribution_id")"
PREFIX="$(ssm "/${SITE_LABEL}/status-site/content_prefix")"
echo "  bucket=${BUCKET}  dist=${DIST_ID}  prefix=${PREFIX}"

# --- stamp the 'updated' field in status.json to now (UTC) ---
if [ "$STAMP" = true ]; then
  NOW="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  tmp="$(mktemp)"
  jq --arg u "$NOW" '.updated = $u' "${SRC}/status.json" > "$tmp" && mv "$tmp" "${SRC}/status.json"
  echo "  stamped updated=${NOW}"
fi

s3() { aws s3 cp "$1" "s3://${BUCKET}/${PREFIX}/$2" --profile "$PROFILE" --region "$REGION" "${@:3}"; }

if [ "$STATUS_ONLY" = true ]; then
  s3 "${SRC}/status.json"  status.json  --content-type application/json --cache-control "max-age=30"
  s3 "${SRC}/marquee.json" marquee.json --content-type application/json --cache-control "max-age=30"
  PATHS="/${PREFIX}/status.json /${PREFIX}/marquee.json"
else
  # full sync of the site under the region prefix; short cache on the json, longer on the shell
  aws s3 sync "${SRC}/" "s3://${BUCKET}/${PREFIX}/" \
    --profile "$PROFILE" --region "$REGION" \
    --delete \
    --exclude "*.json" \
    --cache-control "max-age=3600"
  s3 "${SRC}/status.json"  status.json  --content-type application/json --cache-control "max-age=30"
  s3 "${SRC}/marquee.json" marquee.json --content-type application/json --cache-control "max-age=30"
  PATHS="/${PREFIX}/*"
fi

# --- invalidate so changes go live immediately ---
echo "  invalidating: ${PATHS}"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths ${PATHS} \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Invalidation.Id' --output text

echo "✅ published → https://status.defcon.run/"
