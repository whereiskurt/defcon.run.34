#!/bin/bash
# Builds waffaw Docker image and pushes to ECR
# Usage: ./build.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Common AWS setup
export PAGER=${PAGER:-}
if [[ -z "$GITHUB_ACTIONS" ]]; then
  export AWS_PROFILE=${AWS_PROFILE:-application}
fi
export AWS_REGION=${AWS_REGION:-"us-east-1"}
export REGION_SHORT=${REGION_SHORT:-"use1"}
export AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}

SITE_LABEL=${SITE_LABEL:-"dc34"}
REPO_NAME="${SITE_LABEL}-waffaw"
IMAGE_TAG=${IMAGE_TAG:-"1.0.0"}
LOCAL_TAG="${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}"

echo "=== Building waffaw: AWS_REGION=${AWS_REGION}, REGION_SHORT=${REGION_SHORT}, TAG=${IMAGE_TAG} ==="

# ECR login
if [[ "${SKIP_ECR_LOGIN}" != "true" ]]; then
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
fi

# Build Docker image (amd64 for ECS/EC2)
docker buildx build --load \
  --platform linux/amd64 \
  -t "$LOCAL_TAG" \
  -f "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}/"

# Tag and push
docker tag "${LOCAL_TAG}" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

echo "Image pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"
