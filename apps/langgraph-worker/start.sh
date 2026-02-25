#!/bin/bash

# Set default PORT if not provided
export PORT=${PORT:-8080}
export GUNICORN_WORKERS=${GUNICORN_WORKERS:-2}

echo "Starting LangGraph Worker on port $PORT"

# Verify gunicorn is available
which gunicorn || echo "WARNING: gunicorn not found in PATH: $PATH"

# Start gunicorn with environment-based port (using absolute path as fallback)
# --graceful-timeout: Time workers have to finish during shutdown (must be < Railway drainSeconds)
# --timeout: Request timeout (long for AI processing)
exec /usr/local/bin/gunicorn -k uvicorn.workers.UvicornWorker app.main:app \
    --bind "0.0.0.0:$PORT" \
    --workers "$GUNICORN_WORKERS" \
    --graceful-timeout 110 \
    --timeout 300 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
