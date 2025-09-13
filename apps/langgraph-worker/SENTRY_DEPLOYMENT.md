# Sentry Integration - Docker Deployment Guide

## ✅ Configuration Complete

The LangGraph worker has been fully configured for Sentry error tracking and performance monitoring in Docker environments.

## 📋 Deployment Checklist

### ✅ Docker Configuration
- [x] **sentry-sdk[fastapi]>=2.20.0** added to Dockerfile
- [x] **SENTRY_DSN** environment variable in Dockerfile
- [x] **SENTRY_TRACES_SAMPLE_RATE** set to 0.1 (10% sampling)
- [x] **SENTRY_ENABLE_LOGS** enabled for log forwarding

### ✅ Environment Files
- [x] **.env** updated with production Sentry values
- [x] **railway.toml** configured with Sentry variables for Railway deployment

### ✅ Application Integration
- [x] **Sentry SDK initialization** in app/main.py before FastAPI creation
- [x] **Configuration settings** in app/utils/config.py
- [x] **Enhanced error handling** with context in all endpoints
- [x] **Debug endpoint** `/sentry-debug` for testing

## 🚀 Deployment Methods

### Method 1: Railway Deployment (Recommended)
```bash
# Deploy to Railway - environment variables automatically applied from railway.toml
railway up
```

### Method 2: Docker Build & Run
```bash
# Build Docker image
docker build -t langgraph-worker .

# Run with default Sentry config (from .env)
docker run -p 8080:8080 langgraph-worker

# Run with custom Sentry DSN
docker run -p 8080:8080 \
  -e SENTRY_DSN="your-custom-dsn" \
  -e SENTRY_TRACES_SAMPLE_RATE="0.2" \
  langgraph-worker
```

### Method 3: Production Environment Override
```bash
# For production deployment with different Sentry project
export SENTRY_DSN="https://your-prod-sentry-dsn@sentry.io/project-id"
export SENTRY_TRACES_SAMPLE_RATE="0.05"  # 5% for high-traffic prod
export SENTRY_ENABLE_LOGS="true"

# Then deploy or run Docker container
```

## 🧪 Testing & Verification

### 1. Test Error Tracking
```bash
# After deployment, test error capture
curl http://your-deployment-url/sentry-debug

# Check Sentry dashboard for:
# - Error event with full context
# - Performance transaction data
# - Log messages
```

### 2. Monitor Performance
- **API Response Times**: Automatically tracked for all endpoints
- **Memory Usage**: Included in error contexts
- **Quality Metrics**: Email generation success rates and quality scores
- **Business Context**: Lead information, request IDs, processing times

### 3. Log Integration
All application logs are automatically forwarded to Sentry:
```python
# These logs will appear in Sentry
logger.info("Processing email generation")
logger.warning("High memory usage detected")
logger.error("API call failed")
```

## 🔧 Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | `""` | Sentry project DSN (required for monitoring) |
| `SENTRY_TRACES_SAMPLE_RATE` | `"0.1"` | Performance monitoring sample rate (0.0-1.0) |
| `SENTRY_ENABLE_LOGS` | `"true"` | Enable automatic log forwarding to Sentry |

## 📊 Sentry Dashboard Features

### Error Tracking
- **Automatic Error Capture**: All unhandled exceptions with full context
- **Request Context**: Lead info, request IDs, processing times
- **System Metrics**: Memory usage, queue depths, performance data
- **Business Context**: Company names, quality scores, approval rates

### Performance Monitoring
- **API Endpoint Monitoring**: Response times for all endpoints
- **Transaction Tracing**: Complete request lifecycle tracking
- **Custom Metrics**: Email generation success rates and quality scores
- **System Health**: Memory usage, processing queue status

### Log Management
- **Centralized Logging**: All application logs in one place
- **Context Preservation**: Error context automatically included
- **Search & Filtering**: Find specific issues quickly
- **Real-time Alerts**: Immediate notification of critical issues

## 🛠️ Troubleshooting

### Sentry Not Receiving Events
1. **Check DSN**: Ensure SENTRY_DSN is correctly set
2. **Verify Network**: Ensure container can reach sentry.io
3. **Test Debug Endpoint**: Visit `/sentry-debug` to trigger test error
4. **Check Logs**: Look for Sentry initialization messages in startup logs

### High Event Volume
1. **Adjust Sample Rate**: Lower SENTRY_TRACES_SAMPLE_RATE (e.g., 0.05)
2. **Filter Events**: Configure Sentry project settings to filter noise
3. **Set Release**: Add release tracking for better organization

### Missing Context
1. **Verify Integration**: Check that FastAPI integration is working
2. **Context Setting**: Ensure context is set before operations
3. **Log Levels**: Adjust logging levels for appropriate detail

## 🎯 Next Steps

1. **Deploy**: Use Railway or Docker deployment method above
2. **Test**: Verify error tracking with `/sentry-debug` endpoint
3. **Monitor**: Watch Sentry dashboard for incoming events
4. **Optimize**: Adjust sample rates based on traffic volume
5. **Alert**: Set up Sentry alerts for critical errors

The integration is production-ready and will provide comprehensive observability for the LangGraph worker! 🚀