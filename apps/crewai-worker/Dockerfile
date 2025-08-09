FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    pkg-config \
    libffi-dev \
    libssl-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip/setuptools/wheel for modern packages
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy requirements first for caching
COPY requirements.txt .

# Install Python dependencies
# Fixed langchain-core version to satisfy both langchain and langchain-openai
RUN pip install --no-cache-dir \
    -r requirements.txt \
    langchain-core==0.2.40

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash crewai \
    && chown -R crewai:crewai /app
USER crewai

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Start command - Gunicorn with Uvicorn workers
CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:${PORT:-8080} --workers 2 --access-logfile - --error-logfile -"]