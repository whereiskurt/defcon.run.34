#!/bin/bash

# Use dynamodb-local hostname when running in Docker, localhost:8989 when running locally
ENDPOINT_URL="${DYNAMODB_ENDPOINT:-http://localhost:8000}"

# Wait for DynamoDB Local to be ready
echo "Waiting for DynamoDB Local at $ENDPOINT_URL..."
until aws dynamodb list-tables --endpoint-url "$ENDPOINT_URL" ; do
    sleep 1
done
echo "DynamoDB Local is ready!"

# Create the 'electro' table
# Schema: pk/sk with 2 GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index)
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name electro \
    --attribute-definitions \
        AttributeName=pk,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=gsi1pk,AttributeType=S \
        AttributeName=gsi1sk,AttributeType=S \
        AttributeName=gsi2pk,AttributeType=S \
        AttributeName=gsi2sk,AttributeType=S \
    --key-schema \
        AttributeName=pk,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --global-secondary-indexes \
        '[
            {
                "IndexName": "gsi1pk-gsi1sk-index",
                "KeySchema": [
                    {"AttributeName":"gsi1pk","KeyType":"HASH"},
                    {"AttributeName":"gsi1sk","KeyType":"RANGE"}
                ],
                "Projection": {
                    "ProjectionType":"ALL"
                },
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5
                }
            },
            {
                "IndexName": "gsi2pk-gsi2sk-index",
                "KeySchema": [
                    {"AttributeName":"gsi2pk","KeyType":"HASH"},
                    {"AttributeName":"gsi2sk","KeyType":"RANGE"}
                ],
                "Projection": {
                    "ProjectionType":"ALL"
                },
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5
                }
            }
        ]'

echo "Created 'electro' table"

# Create the 'auth' table
# Schema: pk/sk with 1 GSI (gsi1pk-gsi1sk-index), TTL enabled on 'ttl' attribute
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name auth \
    --attribute-definitions \
        AttributeName=pk,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
        AttributeName=pk,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --global-secondary-indexes \
        '[
            {
                "IndexName": "GSI1",
                "KeySchema": [
                    {"AttributeName":"GSI1PK","KeyType":"HASH"},
                    {"AttributeName":"GSI1SK","KeyType":"RANGE"}
                ],
                "Projection": {
                    "ProjectionType":"ALL"
                },
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5
                }
            }
        ]'

echo "Created 'auth' table"

# Enable TTL on the 'auth' table
aws dynamodb update-time-to-live \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name auth \
    --time-to-live-specification "Enabled=true, AttributeName=ttl"

echo "Enabled TTL on 'auth' table"

echo "All tables created successfully!"
aws dynamodb list-tables --endpoint-url "$ENDPOINT_URL"
