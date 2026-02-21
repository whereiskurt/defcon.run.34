#!/bin/bash
set -euo pipefail

# Install Docker
yum install -y docker
systemctl enable --now docker

# Login to ECR
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecr_repo}

# Pull and run the waffaw agent
docker pull ${ecr_repo}/${image_uri}
docker run -d \
  --restart=always \
  --name waffaw-agent \
  -e CONTROL_BUCKET=${control_bucket} \
  -e REGION=${region} \
  -e NODE_TYPE=ec2 \
  -e LOG_LEVEL=${log_level} \
  ${ecr_repo}/${image_uri}
