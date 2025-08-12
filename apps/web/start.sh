#!/bin/sh

# Start script for Railway deployment
# Handles PORT environment variable for serve command

if [ -n "$PORT" ]; then
    echo "Starting serve on port $PORT"
    serve -s dist -l $PORT
else
    echo "Starting serve on default port 3000"
    serve -s dist
fi