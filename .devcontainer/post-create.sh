#!/bin/bash
# Post-create script for DEF CON 34 devcontainer

set -e

npm install -g @anthropic-ai/claude-code

echo "=== Installing webapp dependencies ==="

# Clean and install run.auth dependencies
if [ -d "apps/run.auth/webapp" ]; then
  echo "Cleaning run.auth node_modules..."
  rm -rf apps/run.auth/webapp/node_modules
  echo "Installing run.auth dependencies..."
  cd apps/run.auth/webapp && npm install && cd -
fi

# Clean and install run.human dependencies
if [ -d "apps/run.human/webapp" ]; then
  echo "Cleaning run.human node_modules..."
  rm -rf apps/run.human/webapp/node_modules
  echo "Installing run.human dependencies..."
  cd apps/run.human/webapp && npm install && cd -
fi

# Clean and install run.cms dependencies
if [ -d "apps/run.cms/app" ]; then
  echo "Cleaning run.cms node_modules..."
  rm -rf apps/run.cms/app/node_modules
  echo "Installing run.cms (Strapi) dependencies..."
  cd apps/run.cms/app && npm install && cd -
fi


# Clean and install run.cms dependencies
if [ -d "apps/run.gpx/webapp" ]; then
  echo "Cleaning run.gpx node_modules..."
  rm -rf apps/run.gpx/webapp/node_modules
  echo "Installing run.gpx (gpx.studio) dependencies..."
  cd apps/run.gpx/webapp && npm install && cd -
  cd apps/run.gpx/ && ./build-frontend.sh && cd -
fi

echo "=== Verifying tool installations ==="
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo "Docker: $(docker --version)"
echo "AWS CLI: $(aws --version)"
echo "Terraform: $(terraform --version | head -1)"
echo "Terragrunt: $(terragrunt --version)"
echo "SOPS: $(sops --version)"
echo ""
echo ""
echo "=== defcon.run 34 Development Environment Ready ==="
echo ""
echo "Quick start:"
echo "  cd apps/run.gpx/webapp && PORT=3003 npm run dev"
echo "  cd apps/run.auth/webapp && PORT=3002 npm run dev"
echo "  cd apps/run.human/webapp && PORT=3001 npm run dev"
echo "  cd apps/run.cms/app && PORT=1337 npm run dev"
echo ""
echo "Build & Deploy:"
echo "  ./apps/release-all.sh --apps run.auth   # Full release workflow"
echo ""
echo "Infrastructure:"
echo "  cd infra/terraform/live/site && terragrunt plam --all -- -auto-approve"
echo ""
