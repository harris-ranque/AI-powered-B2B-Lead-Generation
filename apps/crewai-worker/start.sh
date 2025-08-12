#!/bin/bash

# Set default PORT if not provided
export PORT=${PORT:-8080}

echo "Starting CrewAI Worker on port $PORT"

# Start gunicorn with environment-based port
exec gunicorn -k uvicorn.workers.UvicornWorker app.main:app \
    --bind "0.0.0.0:$PORT" \
    --workers 2 \
    --access-logfile - \
    --error-logfile - \
    --log-level info