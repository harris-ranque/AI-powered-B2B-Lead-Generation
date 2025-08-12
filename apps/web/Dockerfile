# Use Node.js 18 Alpine for smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm directly without corepack to avoid signature issues
RUN npm install -g pnpm@latest

# Copy workspace files from root context
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy web app source
COPY apps/web ./apps/web

# Change to web app directory
WORKDIR /app/apps/web

# Create mock Convex files and build
RUN node convex-mock.cjs && pnpm build

# Install serve for production
RUN npm install -g serve

# Expose port
EXPOSE 3000

# Start command
CMD ["serve", "-s", "dist", "-l", "3000"]