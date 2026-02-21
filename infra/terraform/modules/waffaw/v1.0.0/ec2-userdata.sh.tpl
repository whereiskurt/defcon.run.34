#!/bin/bash
set -euo pipefail

# Install Docker
yum install -y docker
systemctl enable --now docker

# Login to ECR
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecr_repo}

# Pull and run the waffaw agent with CloudWatch logging
docker pull ${ecr_repo}/${image_uri}
docker run -d \
  --restart=always \
  --name waffaw-agent \
  --log-driver=awslogs \
  --log-opt awslogs-region=${region} \
  --log-opt awslogs-group=${log_group} \
  --log-opt awslogs-stream-prefix=ec2 \
  --log-opt awslogs-create-group=true \
  -e CONTROL_BUCKET=${control_bucket} \
  -e REGION=${region} \
  -e NODE_TYPE=ec2 \
  -e LOG_LEVEL=${log_level} \
  ${ecr_repo}/${image_uri}
