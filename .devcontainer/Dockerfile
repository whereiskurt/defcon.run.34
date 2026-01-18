# DEF CON 34 Development Container
FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Detect architecture for multi-platform support
ARG TARGETARCH

# Install Terragrunt (version should match GitHub Actions)
ARG TERRAGRUNT_VERSION=0.97.1
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -Lo /usr/local/bin/terragrunt \
    "https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_${ARCH}" \
    && chmod +x /usr/local/bin/terragrunt

# Install Terraform (version should match GitHub Actions)
ARG TERRAFORM_VERSION=1.14.3
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -Lo /tmp/terraform.zip \
    "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip" \
    && unzip /tmp/terraform.zip -d /usr/local/bin \
    && rm /tmp/terraform.zip

# Install SOPS for secrets management (version should match GitHub Actions)
ARG SOPS_VERSION=3.11.0
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -Lo /usr/local/bin/sops \
    "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.${ARCH}" \
    && chmod +x /usr/local/bin/sops

# Install jq for JSON processing
RUN apt-get update && apt-get install -y jq uuid-runtime && rm -rf /var/lib/apt/lists/*

# Create mount target directories for bind mounts
RUN mkdir -p /home/node/.aws /home/node/.claude \
    && chown -R node:node /home/node/.aws /home/node/.claude

# Set working directory
WORKDIR /workspaces/defcon.run.34
