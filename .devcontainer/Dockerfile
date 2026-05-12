FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Install basic build tools if needed
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Supabase CLI globally
RUN npx supabase@latest --version || npm install -g supabase