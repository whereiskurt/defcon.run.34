# DEF CON 34 Development Container
FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Install Terragrunt
ARG TERRAGRUNT_VERSION=0.77.10
RUN curl -Lo /usr/local/bin/terragrunt \
    "https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_amd64" \
    && chmod +x /usr/local/bin/terragrunt

# Install Terraform (specific version for consistency)
ARG TERRAFORM_VERSION=1.9.8
RUN curl -Lo /tmp/terraform.zip \
    "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
    && unzip /tmp/terraform.zip -d /usr/local/bin \
    && rm /tmp/terraform.zip

# Install SOPS for secrets management (uses AWS KMS via mounted credentials)
ARG SOPS_VERSION=3.9.4
RUN curl -Lo /usr/local/bin/sops \
    "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64" \
    && chmod +x /usr/local/bin/sops

# Install jq for JSON processing
RUN apt-get update && apt-get install -y jq uuid-runtime && rm -rf /var/lib/apt/lists/*

# Create mount target directories for bind mounts
RUN mkdir -p /home/node/.aws /home/node/.claude \
    && chown -R node:node /home/node/.aws /home/node/.claude

# Set working directory
WORKDIR /workspaces/defcon.run.34
