# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm@8.15.1

# Copy package files
COPY package.json ./
COPY ../../pnpm-lock.yaml ./
COPY ../../pnpm-workspace.yaml ./

# Copy shared types package if it exists
COPY ../../packages/ ./packages/ 2>/dev/null || true

# Copy app source
COPY . ./

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the application
RUN pnpm build

# Production stage - serve with Node.js
FROM node:18-alpine

WORKDIR /app

# Install serve globally
RUN npm install -g serve@14.2.1

# Copy built files from build stage
COPY --from=build /app/dist ./dist

# Railway will set PORT environment variable
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the application using serve
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]