#!/bin/bash

# Set default PORT if not provided
export PORT=${PORT:-8080}

echo "Starting LangGraph Worker on port $PORT"

# Verify gunicorn is available
which gunicorn || echo "WARNING: gunicorn not found in PATH: $PATH"

# Start gunicorn with environment-based port (using absolute path as fallback)
exec /usr/local/bin/gunicorn -k uvicorn.workers.UvicornWorker app.main:app \
    --bind "0.0.0.0:$PORT" \
    --workers 2 \
    --access-logfile - \
    --error-logfile - \
    --log-level info