FROM mcr.microsoft.com/playwright:v1.50.0-noble

# System dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Artillery + Playwright engine
WORKDIR /opt/waffaw
COPY package.json package-lock.json* ./
COPY plugins/ ./plugins/
RUN npm ci --production || npm install --production

# Agent and scenarios
COPY agent.sh consensus.sh ./
COPY scenarios/ ./scenarios/
COPY templates/ ./templates/
COPY data/ ./data/

RUN chmod +x agent.sh consensus.sh

ENTRYPOINT ["/opt/waffaw/agent.sh"]
