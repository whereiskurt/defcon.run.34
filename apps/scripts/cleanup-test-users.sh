#!/bin/bash
# Cleanup test users from DynamoDB tables
#
# Usage:
#   ./cleanup-test-users.sh                    # Dry run (show what would be deleted)
#   ./cleanup-test-users.sh --execute          # Actually delete
#   ./cleanup-test-users.sh --email "test@example.com"  # Delete specific user by email
#
# Cleans up these test email patterns:
#   - jeanclaude+accounta@defcon.run
#   - jeanclaude+accountb@defcon.run
#   - jeanclaude+accountc@defcon.run

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
SITE_LABEL="${SITE_LABEL:-dc34}"
REGION_LABEL="${REGION_LABEL:-use1}"

# Table names (match terraform config - no site/region prefix in actual names)
AUTH_AUTHJS_TABLE="${AUTH_AUTHJS_TABLE:-run-auth-authjs}"
AUTH_ELECTRO_TABLE="${AUTH_ELECTRO_TABLE:-run-auth-electro}"
QUOTA_TABLE="${QUOTA_TABLE:-run-quota-electro}"
GPX_TABLE="${GPX_TABLE:-run-gpx-electro}"

# Test email patterns to clean up
TEST_EMAILS=(
  "jeanclaude+accounta@defcon.run"
  "jeanclaude+accountb@defcon.run"
  "jeanclaude+accountc@defcon.run"
)

DRY_RUN=true
SPECIFIC_EMAIL=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --execute)
      DRY_RUN=false
      shift
      ;;
    --email)
      SPECIFIC_EMAIL="$2"
      shift 2
      ;;
    --help|-h)
      head -15 "$0" | tail -13
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -n "$SPECIFIC_EMAIL" ]]; then
  TEST_EMAILS=("$SPECIFIC_EMAIL")
fi

echo "=============================================="
echo "  TEST USER CLEANUP"
echo "=============================================="
echo "Region: $AWS_REGION"
echo "Tables:"
echo "  - Auth.js:  $AUTH_AUTHJS_TABLE"
echo "  - Profile:  $AUTH_ELECTRO_TABLE"
echo "  - Quota:    $QUOTA_TABLE"
echo "  - GPX:      $GPX_TABLE"
echo ""
echo "Emails to clean: ${TEST_EMAILS[*]}"
echo "Dry run: $DRY_RUN"
echo "=============================================="
echo ""

# Function to delete items from a table
delete_items() {
  local table=$1
  local pk_name=$2
  local sk_name=$3
  shift 3
  local items=("$@")

  for item in "${items[@]}"; do
    local pk=$(echo "$item" | jq -r ".$pk_name.S // .$pk_name.N // empty")
    local sk=$(echo "$item" | jq -r ".$sk_name.S // .$sk_name.N // empty")

    if [[ -z "$pk" ]]; then
      continue
    fi

    local key="{\"$pk_name\": {\"S\": \"$pk\"}}"
    if [[ -n "$sk" && "$sk" != "null" ]]; then
      key="{\"$pk_name\": {\"S\": \"$pk\"}, \"$sk_name\": {\"S\": \"$sk\"}}"
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would delete: $pk / $sk"
    else
      echo "  Deleting: $pk / $sk"
      aws dynamodb delete-item \
        --region "$AWS_REGION" \
        --table-name "$table" \
        --key "$key" 2>/dev/null || echo "    (failed or not found)"
    fi
  done
}

for EMAIL in "${TEST_EMAILS[@]}"; do
  echo ""
  echo "--- Processing: $EMAIL ---"

  # 1. Find user in Auth.js table (by email GSI)
  echo ""
  echo "Searching Auth.js table for user..."
  USER_ITEMS=$(aws dynamodb query \
    --region "$AWS_REGION" \
    --table-name "$AUTH_AUTHJS_TABLE" \
    --index-name "GSI1" \
    --key-condition-expression "GSI1PK = :pk" \
    --expression-attribute-values "{\":pk\": {\"S\": \"USER#email#$EMAIL\"}}" \
    --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

  if [[ -n "$USER_ITEMS" ]]; then
    echo "Found Auth.js user records:"
    USER_ID=""
    while IFS= read -r item; do
      pk=$(echo "$item" | jq -r '.pk.S')
      sk=$(echo "$item" | jq -r '.sk.S')
      echo "  - $pk / $sk"
      # Extract user ID (format: USER#<id>)
      if [[ "$pk" == USER#* ]]; then
        USER_ID="${pk#USER#}"
      fi
    done <<< "$USER_ITEMS"

    if [[ -n "$USER_ID" ]]; then
      echo "User ID: $USER_ID"

      # Find all Auth.js records for this user
      echo ""
      echo "Finding all Auth.js records for user..."
      ALL_USER_ITEMS=$(aws dynamodb query \
        --region "$AWS_REGION" \
        --table-name "$AUTH_AUTHJS_TABLE" \
        --key-condition-expression "pk = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"USER#$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$ALL_USER_ITEMS" ]]; then
        echo "Auth.js records to delete:"
        while IFS= read -r item; do
          delete_items "$AUTH_AUTHJS_TABLE" "pk" "sk" "$item"
        done <<< "$ALL_USER_ITEMS"
      fi

      # Also delete account links, sessions
      echo ""
      echo "Finding account links..."
      ACCOUNT_ITEMS=$(aws dynamodb scan \
        --region "$AWS_REGION" \
        --table-name "$AUTH_AUTHJS_TABLE" \
        --filter-expression "contains(pk, :uid)" \
        --expression-attribute-values "{\":uid\": {\"S\": \"$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$ACCOUNT_ITEMS" ]]; then
        echo "Account/session records to delete:"
        while IFS= read -r item; do
          delete_items "$AUTH_AUTHJS_TABLE" "pk" "sk" "$item"
        done <<< "$ACCOUNT_ITEMS"
      fi

      # 2. Delete from Auth Profile table (ElectroDB)
      echo ""
      echo "Searching Auth Profile table..."
      PROFILE_ITEMS=$(aws dynamodb query \
        --region "$AWS_REGION" \
        --table-name "$AUTH_ELECTRO_TABLE" \
        --key-condition-expression "pk = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"\$authprofile#userId_$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$PROFILE_ITEMS" ]]; then
        echo "Profile records to delete:"
        while IFS= read -r item; do
          delete_items "$AUTH_ELECTRO_TABLE" "pk" "sk" "$item"
        done <<< "$PROFILE_ITEMS"
      fi

      # 3. Delete from Quota table
      echo ""
      echo "Searching Quota table..."
      QUOTA_ITEMS=$(aws dynamodb query \
        --region "$AWS_REGION" \
        --table-name "$QUOTA_TABLE" \
        --key-condition-expression "pk = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"\$userquota#userId_$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$QUOTA_ITEMS" ]]; then
        echo "Quota records to delete:"
        while IFS= read -r item; do
          delete_items "$QUOTA_TABLE" "pk" "sk" "$item"
        done <<< "$QUOTA_ITEMS"
      fi

      # 4. Delete from GPX table
      echo ""
      echo "Searching GPX table..."
      GPX_ITEMS=$(aws dynamodb query \
        --region "$AWS_REGION" \
        --table-name "$GPX_TABLE" \
        --key-condition-expression "pk = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"\$gpxfile#userId_$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$GPX_ITEMS" ]]; then
        echo "GPX file records to delete:"
        while IFS= read -r item; do
          delete_items "$GPX_TABLE" "pk" "sk" "$item"
        done <<< "$GPX_ITEMS"
      fi

      # Also check for folders and shares
      FOLDER_ITEMS=$(aws dynamodb query \
        --region "$AWS_REGION" \
        --table-name "$GPX_TABLE" \
        --key-condition-expression "pk = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"\$gpxfolder#userId_$USER_ID\"}}" \
        --output json 2>/dev/null | jq -c '.Items[]' 2>/dev/null || echo "")

      if [[ -n "$FOLDER_ITEMS" ]]; then
        echo "GPX folder records to delete:"
        while IFS= read -r item; do
          delete_items "$GPX_TABLE" "pk" "sk" "$item"
        done <<< "$FOLDER_ITEMS"
      fi

    fi
  else
    echo "No Auth.js user found for $EMAIL"
  fi
done

echo ""
echo "=============================================="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY RUN COMPLETE - no changes made"
  echo "Run with --execute to actually delete"
else
  echo "CLEANUP COMPLETE"
fi
echo "=============================================="
