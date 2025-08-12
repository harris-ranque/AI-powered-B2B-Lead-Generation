# Use Node.js 18 Alpine for smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm directly without corepack to avoid signature issues
RUN npm install -g pnpm@latest

# Copy package files (Railway builds from /apps/web directory)
COPY package.json ./
COPY pnpm-lock-real.yaml ./pnpm-lock.yaml

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Create mock Convex files and build
RUN node convex-mock.cjs && pnpm build

# Install serve for production
RUN npm install -g serve

# Expose port
EXPOSE 3000

# Start command
CMD ["serve", "-s", "dist", "-l", "3000"]