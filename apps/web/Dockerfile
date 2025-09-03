# Railway build from monorepo root context
FROM node:18-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@latest

# Copy monorepo files (Railway context is ../.., so this gets the whole repo)
COPY . .

# Install all dependencies
RUN pnpm install

# Accept build-time environment variables for Vite
ARG VITE_CONVEX_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ARG ENVIRONMENT=production
ARG NODE_ENV=production

# Set environment variables
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
ENV ENVIRONMENT=$ENVIRONMENT
ENV NODE_ENV=$NODE_ENV

# Generate Convex types from backend and copy to web app
RUN cd apps/convex-backend && \
    pnpm exec convex codegen && \
    cp -r convex/_generated ../web/convex/

# Build the web app
RUN cd apps/web && \
    if [ "$NODE_ENV" = "development" ] || [ "$ENVIRONMENT" = "development" ]; then \
        pnpm build:dev; \
    else \
        pnpm build; \
    fi

# Production stage
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Create nginx config template that uses Railway's $PORT
RUN echo 'server { \
    listen ${PORT}; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /api { \
        return 404; \
    } \
}' > /etc/nginx/conf.d/default.conf.template

# Create startup script that substitutes PORT and starts nginx
RUN echo '#!/bin/sh\nenvsubst '"'"'${PORT}'"'"' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf\nexec nginx -g "daemon off;"' > /docker-entrypoint.sh && \
    chmod +x /docker-entrypoint.sh

# Railway will set PORT environment variable
ENV PORT=80
EXPOSE $PORT

CMD ["/docker-entrypoint.sh"]