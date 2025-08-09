# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy workspace root files
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./

# Copy packages directory if it exists
COPY packages/ ./packages/ 2>/dev/null || true

# Copy web app specific files
COPY apps/web/ ./apps/web/

# Install dependencies from workspace root
RUN pnpm install --frozen-lockfile

# Build the web application
WORKDIR /app/apps/web
RUN pnpm build

# Production stage - serve with nginx
FROM nginx:alpine

# Copy built files from build stage
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port (Railway will inject $PORT)
EXPOSE 80

# Start nginx
CMD ["sh", "-c", "envsubst '$$PORT' < /etc/nginx/conf.d/default.conf > /tmp/default.conf && mv /tmp/default.conf /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]