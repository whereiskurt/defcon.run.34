#!/bin/bash
# Post-create script for DEF CON 34 devcontainer

set -e

echo "=== Installing webapp dependencies ==="

# Install dependencies for both webapps
if [ -d "apps/run.auth/webapp" ]; then
  echo "Installing run.auth dependencies..."
  cd apps/run.auth/webapp && npm install && cd -
fi

if [ -d "apps/run.human/webapp" ]; then
  echo "Installing run.human dependencies..."
  cd apps/run.human/webapp && npm install && cd -
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
echo "=== DEF CON 34 Development Environment Ready ==="
echo ""
echo "Quick start:"
echo "  cd apps/run.auth/webapp && npm run dev    # Start auth service on :3000"
echo "  cd apps/run.human/webapp && npm run dev   # Start main app on :3001"
echo ""
echo "Build & Deploy:"
echo "  ./apps/build.sh webapp run.auth           # Build and push to ECR"
echo "  ./apps/release.sh run.auth                # Full release workflow"
echo ""
echo "Infrastructure:"
echo "  cd infra/terraform/live/site && terragrunt run-all plan"
echo ""
