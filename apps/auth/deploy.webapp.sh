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

cd webapp
npm run build
AWS_PROFILE=application aws s3 sync .next/static s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/_next/static --cache-control 'public,max-age=31536000,immutable' --delete --exclude '*.map'
AWS_PROFILE=application aws s3 cp .next/server/app/index.html s3://${WEBAPP_ORIGIN_BUCKET}/index.html --cache-control 'public,max-age=31536000,immutable'
cd ..

docker buildx build --platform=linux/amd64 -t $REPO_NAME:$IMAGE_TAG -f webapp/Dockerfile.webapp ./webapp/

aws ecr get-login-password --region ${AWS_REGION} \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker tag "${REPO_NAME}:${IMAGE_TAG}" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"