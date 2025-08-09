# Stage 1: Builder
FROM python:3.11-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential libffi-dev libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

COPY requirements.txt .

RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim
WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY . .

RUN useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

CMD ["sh", "-c",
     "gunicorn -k uvicorn.workers.UvicornWorker app.main:app "
     "--bind 0.0.0.0:${PORT:-8080} --workers 2 "
     "--access-logfile - --error-logfile -"]