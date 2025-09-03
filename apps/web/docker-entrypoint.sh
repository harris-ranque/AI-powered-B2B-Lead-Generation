#!/bin/sh
# Railway startup script that configures nginx with dynamic PORT

# Substitute the PORT environment variable in nginx config template
envsubst '$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g "daemon off;"