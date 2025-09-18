FROM python:3.11-slim

WORKDIR /app

# Build-time secrets required for integration tests
ARG OPENAI_API_KEY=""
ARG WEBHOOK_URL=""
ARG CONVEX_URL=""
ARG LANGGRAPH_API_KEY=""
ARG TAVILY_API_KEY=""
ARG EXA_API_KEY=""
ARG PERPLEXITY_API_KEY=""

# Make secrets available to build steps (tests) and runtime unless overridden later
ENV OPENAI_API_KEY=${OPENAI_API_KEY} \
    WEBHOOK_URL=${WEBHOOK_URL} \
    CONVEX_URL=${CONVEX_URL} \
    LANGGRAPH_API_KEY=${LANGGRAPH_API_KEY} \
    TAVILY_API_KEY=${TAVILY_API_KEY} \
    EXA_API_KEY=${EXA_API_KEY} \
    PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}

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
    "beautifulsoup4>=4.12.0,<5.0.0" \
    "sentry-sdk[fastapi]>=2.20.0,<3.0.0"

# Copy application code
COPY . .

# Make startup script executable
RUN chmod +x start.sh

# Run tests before finalizing build (fail build if tests fail)
RUN echo "🧪 Running Python tests before deployment..." && \
    python3 -m py_compile app/main.py && \
    echo "✅ Type checking passed" && \
    python3 test_comprehensive_integration.py && \
    echo "✅ Integration tests passed" && \
    python3 test_api_integrations.py && \
    echo "✅ API tests passed, build ready for deployment"

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash langgraph
RUN chown -R langgraph:langgraph /app
USER langgraph

# Set default PORT environment variable
ENV PORT=8080

# Set Sentry environment variables with defaults (can be overridden at runtime)
ENV SENTRY_DSN="" \
    SENTRY_TRACES_SAMPLE_RATE="0.1" \
    SENTRY_ENABLE_LOGS="true"

# Health check with default port fallback
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Use startup script for better environment handling
CMD ["./start.sh"]
