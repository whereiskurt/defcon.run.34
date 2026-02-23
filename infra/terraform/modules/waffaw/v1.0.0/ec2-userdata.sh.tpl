#!/bin/bash
set -euo pipefail

# Install Docker on AL2023
dnf install -y docker
systemctl enable --now docker

# Login to ECR
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecr_repo}

# Pull and run the waffaw agent with CloudWatch logging
# Note: awslogs-stream-prefix and awslogs-create-group are ECS-specific
# extensions not available in stock Docker; use only standard awslogs opts
docker pull ${ecr_repo}/${image_uri}
docker run -d \
  --restart=always \
  --name waffaw-agent \
  --log-driver=awslogs \
  --log-opt awslogs-region=${region} \
  --log-opt awslogs-group=${log_group} \
  -e CONTROL_BUCKET=${control_bucket} \
  -e REGION=${region} \
  -e NODE_TYPE=ec2 \
  -e LOG_LEVEL=${log_level} \
  -e IMAGE_TAG=${image_tag} \
  ${ecr_repo}/${image_uri}
