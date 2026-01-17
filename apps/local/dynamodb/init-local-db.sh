#!/bin/bash

# Use dynamodb-local hostname when running in Docker, localhost:8989 when running locally
ENDPOINT_URL="${DYNAMODB_ENDPOINT:-http://localhost:8000}"

# Wait for DynamoDB Local to be ready
echo "Waiting for DynamoDB Local at $ENDPOINT_URL..."
until aws dynamodb list-tables --endpoint-url "$ENDPOINT_URL" ; do
    sleep 1
done
echo "DynamoDB Local is ready!"

###############################################################################
# run.auth tables
###############################################################################

# Create the 'run-auth-electro' table
# Schema: pk/sk with 2 GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index)
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-auth-electro \
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

echo "Created 'run-auth-electro' table"

# Create the 'run-auth-authjs' table
# Schema: pk/sk with 1 GSI (GSI1), TTL enabled on 'ttl' attribute
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-auth-authjs \
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

echo "Created 'run-auth-authjs' table"

# Enable TTL on the 'run-auth-authjs' table
aws dynamodb update-time-to-live \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-auth-authjs \
    --time-to-live-specification "Enabled=true, AttributeName=ttl"

echo "Enabled TTL on 'run-auth-authjs' table"

###############################################################################
# run-quota table (centralized quota service)
###############################################################################

# Create the 'run-quota' table
# Schema: pk/sk with 1 GSI (gsi1pk-gsi1sk-index for quota type queries)
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-quota \
    --attribute-definitions \
        AttributeName=pk,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=gsi1pk,AttributeType=S \
        AttributeName=gsi1sk,AttributeType=S \
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
            }
        ]'

echo "Created 'run-quota' table"

###############################################################################
# run.human tables
###############################################################################

# Create the 'run-human-electro' table
# Schema: pk/sk with 2 GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index)
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-human-electro \
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

echo "Created 'run-human-electro' table"

# Create the 'run-human-authjs' table
# Schema: pk/sk with 1 GSI (GSI1), TTL enabled on 'ttl' attribute
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-human-authjs \
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

echo "Created 'run-human-authjs' table"

# Enable TTL on the 'run-human-authjs' table
aws dynamodb update-time-to-live \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-human-authjs \
    --time-to-live-specification "Enabled=true, AttributeName=ttl"

echo "Enabled TTL on 'run-human-authjs' table"

###############################################################################
# run.gpx tables
###############################################################################

# Create the 'run-gpx-electro' table
# Schema: pk/sk with 2 GSIs
# - gsi1pk-gsi1sk-index: for createdAt ordering and folder parent queries
# - gsi2pk-gsi2sk-index: for folder queries (files by folder, folders by user)
aws dynamodb create-table \
    --endpoint-url "$ENDPOINT_URL" \
    --table-name run-gpx-electro \
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

echo "Created 'run-gpx-electro' table"

echo "All tables created successfully!"
aws dynamodb list-tables --endpoint-url "$ENDPOINT_URL"
