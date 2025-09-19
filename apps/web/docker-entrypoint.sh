#!/bin/sh
# Railway startup script that configures nginx with dynamic PORT

# Copy the comprehensive nginx config and substitute PORT
envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g "daemon off;"