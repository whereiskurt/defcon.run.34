#!/bin/bash
# Builds run.gpx Docker image and pushes to ECR
# Usage: ./build.sh
#
# This is a placeholder script. The actual build will be integrated
# into apps/build.sh once the webapp is scaffolded (Phase 1.2).
#
# Build process:
# 1. Apply patches to gpx-studio submodule
# 2. Build gpx-studio frontend (SvelteKit -> static)
# 3. Copy built frontend to webapp/public/gpx/
# 4. Build Next.js webapp
# 5. Create Docker image
# 6. Push to ECR

set -e

echo "=== run.gpx build script ==="
echo "This is a placeholder. Use apps/build.sh webapp run.gpx once Phase 1.2 is complete."
echo ""
echo "Current VERSION: $(cat VERSION)"

exit 0
