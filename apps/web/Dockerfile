# Use Node.js 18 Alpine for smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm directly without corepack to avoid signature issues
RUN npm install -g pnpm@latest

# Copy package files (Railway now builds from /apps/web directory)
COPY package.json ./
COPY pnpm-lock-real.yaml ./pnpm-lock.yaml

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

# Start command (Railway will provide $PORT)
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]