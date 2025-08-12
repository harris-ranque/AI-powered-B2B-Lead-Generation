# Use Node.js 18 Alpine for smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm directly without corepack to avoid signature issues
RUN npm install -g pnpm@latest

# Copy package files (Railway now builds from /apps/web directory)
COPY package.json ./
COPY pnpm-lock-real.yaml ./pnpm-lock.yaml

# Create workspace packages with mock content for build
RUN mkdir -p packages/convex-types packages/shared-types

# Create mock convex-types package with required files
RUN echo '{"name":"@genni/convex-types","version":"1.0.0","main":"./src/_generated/api.js","types":"./src/_generated/api.d.ts","exports":{".":{"types":"./src/_generated/api.d.ts","default":"./src/_generated/api.js"},"./dataModel":{"types":"./src/_generated/dataModel.d.ts","default":"./src/_generated/dataModel.js"}}}' > packages/convex-types/package.json && \
    mkdir -p packages/convex-types/src/_generated && \
    echo 'export const api = {};' > packages/convex-types/src/_generated/api.js && \
    echo 'export declare const api: any;' > packages/convex-types/src/_generated/api.d.ts && \
    echo 'export {};' > packages/convex-types/src/_generated/dataModel.js && \
    echo 'export {};' > packages/convex-types/src/_generated/dataModel.d.ts

# Create mock shared-types package  
RUN echo '{"name":"@genni/shared-types","version":"1.0.0","main":"./src/index.js","types":"./src/index.d.ts"}' > packages/shared-types/package.json && \
    mkdir -p packages/shared-types/src && \
    echo 'export {};' > packages/shared-types/src/index.ts && \
    echo 'export {};' > packages/shared-types/src/index.js && \
    echo 'export {};' > packages/shared-types/src/index.d.ts

# Create minimal pnpm-workspace.yaml for Docker context
RUN echo -e "packages:\n  - 'packages/*'" > pnpm-workspace.yaml

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Accept build-time environment variables for Vite
ARG VITE_CONVEX_URL
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ARG ENVIRONMENT
ARG NODE_ENV

# Set environment variables for build
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
ENV ENVIRONMENT=$ENVIRONMENT
ENV NODE_ENV=$NODE_ENV

# Create mock Convex files and build with proper mode
RUN node convex-mock.cjs && \
    if [ "$NODE_ENV" = "development" ] || [ "$ENVIRONMENT" = "development" ]; then \
        pnpm build:dev; \
    else \
        pnpm build; \
    fi

# Install serve for production
RUN npm install -g serve

# Expose port (Railway will override with $PORT)
EXPOSE 3000

# Copy and make start script executable
COPY start.sh ./
RUN chmod +x start.sh

# Start command (Railway will provide $PORT)
CMD ["./start.sh"]