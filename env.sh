#!/bin/bash

export GUID=${GUID:-$(uuidgen)}
export SGUID=$(echo ${GUID:0:8} | tr '[:upper:]' '[:lower:]')

## Local development ports
export LOCAL_RUN_PORT="${LOCAL_RUN_PORT:-3001}"
export LOCAL_AUTH_PORT="${LOCAL_AUTH_PORT:-3002}"
export LOCAL_GPX_PORT="${LOCAL_GPX_PORT:-3003}"
export LOCAL_CMS_PORT="${LOCAL_CMS_PORT:-1337}"

## Site domain configuration
export SITE_DOMAIN="${SITE_DOMAIN:-defcon.run}"
export REGION_SHORT="${REGION_SHORT:-use1}"

## URL configuration for cross-service communication (local development defaults)
export AUTH_PUBLIC_URL="${AUTH_PUBLIC_URL:-http://localhost:${LOCAL_AUTH_PORT}}"
export AUTH_INTERNAL_URL="${AUTH_INTERNAL_URL:-http://localhost:${LOCAL_AUTH_PORT}}"
export RUN_PUBLIC_URL="${RUN_PUBLIC_URL:-http://localhost:${LOCAL_RUN_PORT}}"
export GPX_PUBLIC_URL="${GPX_PUBLIC_URL:-http://localhost:${LOCAL_GPX_PORT}}"
export CMS_PUBLIC_URL="${CMS_PUBLIC_URL:-http://localhost:${LOCAL_CMS_PORT}}"

## Sensitive configuration - override these before sourcing this file
## Example: export TF_VAR_APPLICATION_ACCOUNT_ID="123456789012" && source env.sh
export TF_VAR_APPLICATION_ACCOUNT_ID="${TF_VAR_APPLICATION_ACCOUNT_ID:-000000000000}"
export TF_VAR_MANAGEMENT_ACCOUNT_ID="${TF_VAR_MANAGEMENT_ACCOUNT_ID:-000000000000}"
export TF_VAR_GITHUB_ORG="${TF_VAR_GITHUB_ORG:-your-github-org}"
export TF_VAR_FWD_EMAIL_TO_ADDRESS="${TF_VAR_FWD_EMAIL_TO_ADDRESS:-admin@example.com}"
export TF_VAR_SOPS_KMS_KEY_ID="${TF_VAR_SOPS_KMS_KEY_ID:-mrk-00000000000000000000000000000000}"

## The state is stored in the bucket and the table is used for locking
## One entry per region supported
export TG_TABLE_CAC1="tf-defcon-run-cac1-${SGUID}"
export TG_BUCKET_CAC1="tf-defcon-run-cac1-${SGUID}"
export TG_BUCKET_USE1="tf-defcon-run-use1-${SGUID}"
export TG_TABLE_USE1="tf-defcon-run-use1-${SGUID}"
export TG_BUCKET_USW2="tf-defcon-run-usw2-${SGUID}"
export TG_TABLE_USW2="tf-defcon-run-usw2-${SGUID}"
export TG_BUCKET_APSE1="tf-defcon-run-apse1-${SGUID}"
export TG_TABLE_APSE1="tf-defcon-run-apse1-${SGUID}"

unset AWS_ACCESS_KEY_ID                                           
unset AWS_SECRET_ACCESS_KEY                                              
unset AWS_SESSION_TOKEN                                                  
unset AWS_CREDENTIAL_EXPIRATION                                          

### Comment this out if you're not using SSO
##aws sso logout
aws sso login --sso-session=Developer

## Terragrunt uses AWS to setup s3/dynamo and uses the default profile,
## doing this sets makes terragrunt use the terraform profile for it's s3/dynamo creations
$(aws configure export-credentials --profile terraform --format env) 
