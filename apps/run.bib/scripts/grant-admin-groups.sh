#!/bin/bash
# Grant admin + bibadmin + runadmin to specific users, PRESERVING existing
# services (union, not overwrite). Run once. Requires jq + AWS profile with
# write access to run-auth-electro (Kurt 2026-07-11).
set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-dc34-application}"
REGION="us-east-1"
TABLE="run-auth-electro"
ADD=("admin" "bibadmin" "runadmin")
USERS=("whereiskurt@gmail.com" "jessekrembs@gmail.com")

for EMAIL in "${USERS[@]}"; do
  echo "== $EMAIL =="
  PK=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --index-name gsi1pk-gsi1sk-index --key-condition-expression "gsi1pk = :e" --expression-attribute-values "{\":e\":{\"S\":\"\$oidc#email_${EMAIL}\"}}" --query 'Items[0].pk.S' --output text)
  if [ -z "$PK" ] || [ "$PK" = "None" ]; then echo "  NOT FOUND — skipping"; continue; fi
  CURRENT=$(aws dynamodb get-item --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --query 'Item.services.L[].S' --output json)
  MERGED=$(printf '%s\n' "$CURRENT" | jq -c --argjson add "$(printf '%s\n' "${ADD[@]}" | jq -R . | jq -s .)" '(. // []) + $add | unique')
  echo "  current: $CURRENT"
  echo "  merged:  $MERGED"
  VALUES=$(printf '%s' "$MERGED" | jq -c '{":s":{"L":(map({"S":.}))}}')
  aws dynamodb update-item --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --update-expression "SET services = :s" --expression-attribute-values "$VALUES"
  echo "  updated."
done
echo "Done. Users must re-auth or wait ~5 min for the session claim to refresh."
