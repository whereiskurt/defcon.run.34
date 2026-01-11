#!/bin/bash

# Set services for a user by email address
# Usage: ./set-user-services.sh <email> [services...]
# Example: ./set-user-services.sh whereiskurt@gmail.com auth run strava gpxstudio cms

ENDPOINT_URL="${DYNAMODB_ENDPOINT:-http://localhost:8888}"
TABLE_NAME="run-auth-electro"

# Set dummy credentials for local DynamoDB
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <email> <service1> [service2] [service3] ..."
    echo "Example: $0 whereiskurt@gmail.com auth run strava gpxstudio cms"
    exit 1
fi

EMAIL="$1"
shift
SERVICES=("$@")

echo "Looking up user: $EMAIL"

# Find user by email via GSI1
PK=$(aws dynamodb query \
    --endpoint-url "$ENDPOINT_URL" \
    --region us-east-1 \
    --table-name "$TABLE_NAME" \
    --index-name gsi1pk-gsi1sk-index \
    --key-condition-expression "gsi1pk = :email" \
    --expression-attribute-values "{\":email\": {\"S\": \"\$oidc#email_${EMAIL}\"}}" \
    --query 'Items[0].pk.S' \
    --output text 2>/dev/null)

if [ -z "$PK" ] || [ "$PK" = "None" ]; then
    echo "Error: User not found with email: $EMAIL"
    exit 1
fi

echo "Found user with pk: $PK"

# Build services list JSON
SERVICES_JSON=""
for svc in "${SERVICES[@]}"; do
    if [ -n "$SERVICES_JSON" ]; then
        SERVICES_JSON="$SERVICES_JSON,"
    fi
    SERVICES_JSON="$SERVICES_JSON{\"S\": \"$svc\"}"
done

echo "Setting services: ${SERVICES[*]}"

# Update services
aws dynamodb update-item \
    --endpoint-url "$ENDPOINT_URL" \
    --region us-east-1 \
    --table-name "$TABLE_NAME" \
    --key "{\"pk\": {\"S\": \"$PK\"}, \"sk\": {\"S\": \"\$authprofile_1\"}}" \
    --update-expression "SET services = :s" \
    --expression-attribute-values "{\":s\": {\"L\": [$SERVICES_JSON]}}"

if [ $? -eq 0 ]; then
    echo "Successfully updated services for $EMAIL"
else
    echo "Error: Failed to update services"
    exit 1
fi
