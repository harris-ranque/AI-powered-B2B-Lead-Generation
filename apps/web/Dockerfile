# Use Node.js 18 Alpine for smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm directly without corepack to avoid signature issues
RUN npm install -g pnpm@latest

# Copy package files (Railway now builds from /apps/web directory)
COPY package.json ./
COPY pnpm-lock-real.yaml ./pnpm-lock.yaml

# Create workspace structure for packages (Railway builds from apps/web)
RUN mkdir -p packages/shared-types/src

# Create minimal shared-types package (we don't need convex-types since we have local files)
RUN echo '{"name":"@genni/shared-types","version":"1.0.0","main":"./src/index.js","types":"./src/index.d.ts"}' > packages/shared-types/package.json && \
    echo 'export {};' > packages/shared-types/src/index.ts && \
    echo 'export {};' > packages/shared-types/src/index.js && \
    echo 'export {};' > packages/shared-types/src/index.d.ts

# Create minimal pnpm-workspace.yaml for Docker context
RUN echo -e "packages:\n  - 'packages/*'" > pnpm-workspace.yaml

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Make prebuild script executable if it exists
RUN if [ -f prebuild.sh ]; then chmod +x prebuild.sh; fi

# Accept build-time environment variables for Vite
ARG VITE_CONVEX_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ARG ENVIRONMENT
ARG NODE_ENV

# Set environment variables for build
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
ENV ENVIRONMENT=$ENVIRONMENT
ENV NODE_ENV=$NODE_ENV

# Build with proper mode (Convex types are already in convex/_generated)
RUN if [ "$NODE_ENV" = "development" ] || [ "$ENVIRONMENT" = "development" ]; then \
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