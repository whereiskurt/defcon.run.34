#!/bin/bash

# Script to create a new AWS region configuration with email setup
# Usage: ./create-region.sh <region-name> <region-label>
# Example: ./create-region.sh us-west-2 usw2

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_error() {
    echo -e "${RED}ERROR: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}SUCCESS: $1${NC}"
}

print_info() {
    echo -e "${YELLOW}INFO: $1${NC}"
}

# Function to display usage
usage() {
    cat << EOF
Usage: $0 <region-name> <region-label>

Creates a new AWS region configuration directory with email setup.

Arguments:
    region-name     AWS region name (e.g., us-west-2, eu-west-1, ap-southeast-1)
    region-label    Short label for the region (e.g., usw2, euw1, apse1)

Example:
    $0 us-west-2 usw2
    $0 eu-west-1 euw1
    $0 ap-southeast-1 apse1

This script will:
    1. Create the region directory structure
    2. Generate a region.hcl file with the provided label
    3. Create an email subdirectory
    4. Create symlinks to the base email configuration
    5. Preserve .terraform.lock.hcl files as region-specific

EOF
    exit 1
}

# Validate arguments
if [ $# -ne 2 ]; then
    print_error "Invalid number of arguments"
    usage
fi

REGION_NAME="$1"
REGION_LABEL="$2"

# Validate region name format (basic AWS region format)
if ! [[ "$REGION_NAME" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]]; then
    print_error "Invalid region name format: $REGION_NAME"
    echo "Region name should match AWS format (e.g., us-east-1, eu-west-2)"
    exit 1
fi

# Validate region label (alphanumeric, reasonable length)
if ! [[ "$REGION_LABEL" =~ ^[a-z0-9]{3,8}$ ]]; then
    print_error "Invalid region label format: $REGION_LABEL"
    echo "Region label should be 3-8 lowercase alphanumeric characters (e.g., usw2, euw1)"
    exit 1
fi

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REGION_BASE_DIR="$PROJECT_ROOT/infra/terraform/live/site/region"
NEW_REGION_DIR="$REGION_BASE_DIR/$REGION_NAME"
EMAIL_BASE_DIR="$REGION_BASE_DIR/base/email"

print_info "Project root: $PROJECT_ROOT"
print_info "Creating region: $REGION_NAME with label: $REGION_LABEL"

# Check if region already exists
if [ -d "$NEW_REGION_DIR" ]; then
    print_error "Region directory already exists: $NEW_REGION_DIR"
    exit 1
fi

# Check if base email directory exists
if [ ! -d "$EMAIL_BASE_DIR" ]; then
    print_error "Base email directory not found: $EMAIL_BASE_DIR"
    echo "Please ensure the base email configuration exists before creating new regions."
    exit 1
fi

# Create the region directory
print_info "Creating region directory: $NEW_REGION_DIR"
mkdir -p "$NEW_REGION_DIR"

# Create region.hcl file
print_info "Creating region.hcl with label: $REGION_LABEL"
cat > "$NEW_REGION_DIR/region.hcl" << EOF
locals {
  region = "$REGION_NAME"
  label  = "$REGION_LABEL"
}
EOF

print_success "Created region.hcl"

# Create email subdirectory
EMAIL_DIR="$NEW_REGION_DIR/email"
print_info "Creating email directory: $EMAIL_DIR"
mkdir -p "$EMAIL_DIR"

# Create symlinks to base email configuration
print_info "Creating symlinks to base email configuration"
cd "$EMAIL_DIR"

ln -s ../../base/email/terragrunt.hcl terragrunt.hcl
print_success "Created symlink: email/terragrunt.hcl -> ../../base/email/terragrunt.hcl"

ln -s ../../base/email/email.hcl email.hcl
print_success "Created symlink: email/email.hcl -> ../../base/email/email.hcl"

# Return to original directory
cd - > /dev/null

# Display final directory structure
print_success "Region $REGION_NAME created successfully!"
echo ""
print_info "Directory structure:"
tree -L 2 "$NEW_REGION_DIR" 2>/dev/null || ls -la "$NEW_REGION_DIR"
echo ""
print_info "Email symlinks:"
ls -l "$EMAIL_DIR" | grep "^l"

echo ""
print_info "Next steps:"
echo "  1. Review the configuration in: $NEW_REGION_DIR"
echo "  2. Initialize Terragrunt: cd $EMAIL_DIR && terragrunt init"
echo "  3. Plan the deployment: terragrunt plan"
echo "  4. Apply when ready: terragrunt apply"
