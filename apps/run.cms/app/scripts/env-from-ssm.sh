#!/bin/bash
# Fetch CMS environment variables from AWS SSM Parameter Store
# Usage: ./scripts/env-from-ssm.sh [region_short]
# Example: ./scripts/env-from-ssm.sh use1

set -e

REGION_SHORT="${1:-use1}"
SITE_LABEL="dc34"

# Map region short to full region name
case "$REGION_SHORT" in
  use1) AWS_REGION="us-east-1" ;;
  cac1) AWS_REGION="ca-central-1" ;;
  *) echo "Unknown region: $REGION_SHORT"; exit 1 ;;
esac

export AWS_PROFILE=${AWS_PROFILE:-application}
export AWS_REGION

echo "# =============================================="
echo "# CMS Environment Variables from SSM"
echo "# Region: $REGION_SHORT ($AWS_REGION)"
echo "# Generated: $(date)"
echo "# =============================================="
echo ""

# Function to get SSM parameter value
get_param() {
  local name="$1"
  local env_name="$2"
  local value

  value=$(aws ssm get-parameter --name "$name" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")

  if [[ -n "$value" ]]; then
    echo "${env_name}=${value}"
  else
    echo "# ${env_name}= (not found: $name)"
  fi
}

echo "# Strapi Secrets"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/admin_jwt_secret" "ADMIN_JWT_SECRET"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/api_token_salt" "API_TOKEN_SALT"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/app_keys" "APP_KEYS"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/transfer_token_salt" "TRANSFER_TOKEN_SALT"
echo ""

echo "# OIDC Client (for auth.defcon.run SSO)"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/oidc_client_id" "STRAPI_OIDC_CLIENT_ID"
get_param "/${SITE_LABEL}/secrets/${REGION_SHORT}/strapi/oidc_client_secret" "STRAPI_OIDC_CLIENT_SECRET"
echo ""

echo "# S3 Media Storage"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-media/access_key_id" "S3_MEDIA_ACCESS_KEY"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-media/secret_access_key" "S3_MEDIA_SECRET_KEY"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-media/bucket_name" "S3_MEDIA_BUCKET"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-media/bucket_region" "S3_MEDIA_REGION"
echo ""

echo "# S3 Litestream (database replication)"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-litestream/access_key_id" "S3_LITESTREAM_ACCESS_KEY"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-litestream/secret_access_key" "S3_LITESTREAM_SECRET_KEY"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-litestream/bucket_name" "S3_LITESTREAM_BUCKET"
get_param "/${SITE_LABEL}/uploads/${REGION_SHORT}/cms-litestream/bucket_region" "S3_LITESTREAM_REGION"
echo ""

echo "# AWS SES Email"
# SES SMTP credentials are at /dc34/ses/smtp/default/cms.defcon.run/{username,password,url}
get_param "/${SITE_LABEL}/ses/smtp/default/cms.defcon.run/username" "SES_ACCESS_KEY"
get_param "/${SITE_LABEL}/ses/smtp/default/cms.defcon.run/password" "SES_SECRET_KEY"
get_param "/${SITE_LABEL}/ses/smtp/default/cms.defcon.run/url" "SES_SMTP_URL"
get_param "/${SITE_LABEL}/ses/from_address" "SES_FROM_ADDRESS"
get_param "/${SITE_LABEL}/ses/replyto_address" "SES_REPLYTO_ADDRESS"
echo ""

echo "# Region"
echo "REGION_SHORT=${REGION_SHORT}"
echo "AWS_REGION=${AWS_REGION}"
