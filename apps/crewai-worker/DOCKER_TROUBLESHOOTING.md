# Docker Build Troubleshooting Guide

## Issue: pip install failing in Docker build

### Root Causes Identified:
1. **Missing system dependencies** for compiling Python packages
2. **CrewAI dependency conflicts** with newer versions
3. **Complex transitive dependencies** causing version conflicts

## Solutions Applied:

### 1. Enhanced Dockerfile with System Dependencies ✅
- Added essential build tools: `build-essential`, `gcc`, `g++`
- Added development libraries: `libffi-dev`, `libssl-dev`, `pkg-config`
- Added `git` for packages that install from git repositories
- Upgraded `pip`, `setuptools`, `wheel` for better package handling

### 2. Staged Dependency Installation ✅
- Install dependencies in logical groups to isolate failures
- Core FastAPI dependencies first (most stable)
- Utility dependencies second
- AI/ML dependencies third (most likely to fail)
- CrewAI last (most complex)

### 3. Version Pinning ✅
- Used compatible, tested versions of all packages
- Downgraded CrewAI to stable version (0.86.0)
- Used compatible LangChain versions (0.2.x series)
- Added explicit `setuptools` and `wheel` versions

## Files Created:

### Dockerfile (Enhanced)
- Multi-stage dependency installation
- Better system dependency management
- Improved error isolation

### Dockerfile.minimal (Alternative)
- Lighter alternative with flexible version ranges
- Uses pip directly instead of requirements.txt
- Faster builds with fewer layers

### requirements.txt (Fixed)
- Compatible version combinations
- Organized by dependency category
- Added missing system-level packages

## Usage:

### Try the Enhanced Dockerfile First:
```bash
docker build -t crewai-worker .
```

### If That Fails, Try Minimal Version:
```bash
docker build -f Dockerfile.minimal -t crewai-worker .
```

### For Railway Deployment:
- Use the enhanced Dockerfile by default
- Railway will automatically detect and use it
- Monitor build logs in Railway dashboard

## Common Error Patterns:

### "gcc: command not found"
**Solution**: Already fixed with `build-essential` in system dependencies

### "Failed building wheel for [package]"
**Solution**: Already fixed with upgraded `pip`, `setuptools`, `wheel`

### "No module named '_ctypes'"
**Solution**: Already fixed with `libffi-dev` system dependency

### "Package X conflicts with Package Y"
**Solution**: Version pinning in requirements.txt resolves conflicts

### "Memory limit exceeded"
**Solution**: Use Railway's resource monitoring, consider reducing worker count

## Verification Steps:

1. **Local Build Test**:
```bash
cd apps/crewai-worker
docker build -t test-crewai .
docker run -p 8080:8080 -e PORT=8080 test-crewai
curl http://localhost:8080/health
```

2. **Railway Build**:
- Push changes to repository
- Monitor build logs in Railway dashboard
- Check deployment status

3. **Fallback Options**:
- Use Dockerfile.minimal for lighter builds
- Consider using Railway's Python buildpack instead of Docker
- Use pip install without Docker (railway.json config)

## Performance Optimizations:

### Build Time:
- Staged installations prevent rebuilding on single failures
- System dependency caching
- Multi-stage builds separate build and runtime environments

### Runtime:
- Non-root user for security
- Health checks for monitoring
- Proper signal handling in gunicorn

## Next Steps if Still Failing:

1. Check Railway build logs for specific error messages
2. Test minimal Dockerfile locally
3. Consider using Railway's native Python buildpack
4. Update to latest stable versions of problematic packages
5. Use pip-tools for dependency resolution