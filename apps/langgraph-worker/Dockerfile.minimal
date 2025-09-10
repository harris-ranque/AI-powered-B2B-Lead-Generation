FROM python:3.11-slim

WORKDIR /app

# Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install dependencies directly without requirements.txt to avoid version conflicts
RUN pip install --no-cache-dir \
    fastapi==0.109.0 \
    uvicorn[standard]==0.24.0 \
    gunicorn==21.2.0 \
    pydantic==2.7.0 \
    pydantic-settings==2.9.1 \
    python-dotenv==1.0.0 \
    requests==2.31.0 \
    python-multipart==0.0.6 \
    aiohttp==3.9.0 \
    psutil==5.9.0

# Install newer compatible versions of AI libraries
RUN pip install --no-cache-dir \
    "openai>=1.70.0,<2.0.0" \
    "langchain>=0.3.1,<0.4.0" \
    "langchain-openai>=0.2.1,<0.4.0" \
    "langchain-community>=0.3.1,<0.4.0" \
    "langchain-core>=0.3.1,<0.4.0" \
    "langchain-tavily>=0.1.0,<1.0.0" \
    "langgraph>=0.2.0,<1.0.0" \
    "langgraph-checkpoint>=2.0.0,<3.0.0" \
    "instructor>=1.10.0,<2.0.0" \
    "beautifulsoup4>=4.12.0,<5.0.0"

# Copy application code
COPY . .

# Make startup script executable
RUN chmod +x start.sh

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash langgraph
RUN chown -R langgraph:langgraph /app
USER langgraph

# Set default PORT environment variable
ENV PORT=8080

# Health check with default port fallback
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Use startup script for better environment handling
CMD ["./start.sh"]