#!/bin/bash

export PAGER=${PAGER:-}
export AWS_PROFILE=${AWS_PROFILE:-application}
export AWS_REGION=${AWS_REGION:-"us-east-1"}
export AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export IMAGE_TAG=${IMAGE_TAG:-$(cat "${SCRIPT_DIR}/webapp/VERSION" | tr -d '[:space:]')}
export REPO_NAME="dc34-auth-app"
export WEBAPP_ORIGIN="auth.defcon.run"
export WEBAPP_PREFIX=${WEBAPP_PREFIX:-"use1/assets"}
export REGION_SHORT=${REGION_SHORT:-"use1"}
export WEBAPP_ORIGIN_BUCKET=$(aws ssm get-parameter --name "/dc34/cloudfront-assets/${REGION_SHORT}/auth/bucket_name" --region "${AWS_REGION}" --query "Parameter.Value" --output text)

# Build Docker image (amd64 for ECS)
docker buildx build --platform=linux/amd64 \
  --build-arg NEXT_PUBLIC_ASSET_PREFIX="/${WEBAPP_PREFIX}/public" \
  --build-arg WEBAPP_PREFIX="${WEBAPP_PREFIX}" \
  --build-arg WEBAPP_ORIGIN="${WEBAPP_ORIGIN}" \
  -t $REPO_NAME:$IMAGE_TAG -f webapp/Dockerfile.webapp ./webapp/

# Extract static assets from Docker image and sync to S3
CONTAINER_ID=$(docker create $REPO_NAME:$IMAGE_TAG)
rm -rf /tmp/next-static /tmp/next-public
docker cp $CONTAINER_ID:/app/.next/static /tmp/next-static
docker cp $CONTAINER_ID:/app/.next/server/app/index.html /tmp/next-static
docker cp $CONTAINER_ID:/app/public /tmp/next-public
docker rm $CONTAINER_ID

AWS_PROFILE=application aws s3 sync /tmp/next-static s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/_next/static --cache-control 'public,max-age=31536000,immutable' --delete --exclude '*.map'
AWS_PROFILE=application aws s3 cp /tmp/next-static/index.html s3://${WEBAPP_ORIGIN_BUCKET}/index.html --cache-control 'public,max-age=31536000,immutable'
AWS_PROFILE=application aws s3 sync /tmp/next-public s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public --cache-control 'public,max-age=31536000,immutable' --delete

aws ecr get-login-password --region ${AWS_REGION} \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker tag "${REPO_NAME}:${IMAGE_TAG}" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"