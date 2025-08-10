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
    "openai>=1.30.0" \
    "crewai>=0.80.0,<1.0.0" \
    "langchain>=0.1.0" \
    "langchain-openai>=0.1.0"

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash crewai
RUN chown -R crewai:crewai /app
USER crewai

# Expose port for Railway's health check
EXPOSE ${PORT:-8080}

# Use gunicorn with uvicorn worker (Railway will override this with startCommand)
CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:${PORT:-8080} --workers 2 --access-logfile - --error-logfile -"]