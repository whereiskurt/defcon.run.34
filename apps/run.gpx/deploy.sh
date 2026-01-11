#!/bin/bash
# Deploys run.gpx to ECS
# Usage: ./deploy.sh
#
# This is a placeholder script. The actual deployment will be integrated
# into apps/deploy.sh once infrastructure is provisioned.
#
# Deploy process:
# 1. Copy VERSION files to terraform
# 2. Run terragrunt apply to trigger ECS blue/green deployment

set -e

echo "=== run.gpx deploy script ==="
echo "This is a placeholder. Use apps/deploy.sh run.gpx once infrastructure is complete."
echo ""
echo "Current VERSION: $(cat VERSION)"

exit 0
