# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm@8.15.1

# Copy workspace root files first for better caching
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY turbo.json ./

# Copy packages directory
COPY packages/ ./packages/

# Copy web app specific files
COPY apps/web/package.json ./apps/web/
COPY apps/web/ ./apps/web/

# Install dependencies from workspace root
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the web application
WORKDIR /app/apps/web
RUN pnpm build

# Production stage - serve with Node.js
FROM node:18-alpine

WORKDIR /app

# Install serve globally
RUN npm install -g serve@14.2.1

# Copy built files from build stage
COPY --from=build /app/apps/web/dist ./dist

# Railway will set PORT environment variable
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the application using serve
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]