# LangGraph Studio Setup Guide

## Overview
LangGraph Studio is now successfully configured to work with the Genni LangGraph worker application.

## Installation
The LangGraph CLI has been installed separately from the main dependencies to avoid version conflicts:
```bash
pip install "langgraph-cli[inmem]"
```

## Environment Setup

### Required Environment Variables
Add to `.env` file:
```env
# Your OpenAI API key
OPENAI_API_KEY=sk-...

# LangSmith API key for Studio tracing (required)
# Get from: https://smith.langchain.com/settings
LANGSMITH_API_KEY=ls_...
```

## Configuration Files

### langgraph.json
```json
{
  "dependencies": [
    "."
  ],
  "graphs": {
    "email_generation": "app.langgraph.workflow:create_email_generation_workflow_studio"
  },
  "env": ".env"
}
```

### Workflow Function
A Studio-compatible wrapper function has been added to `app/langgraph/workflow.py`:
```python
def create_email_generation_workflow_studio(config: RunnableConfig) -> StateGraph:
    """
    LangGraph Studio compatible entry point.
    Requires exactly one argument: a RunnableConfig
    """
```

## Running LangGraph Studio

### Start the development server:
```bash
cd apps/langgraph-worker
langgraph dev --port 2024
```

### Access Points:
- **API**: http://127.0.0.1:2024
- **Studio UI**: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
- **API Docs**: http://127.0.0.1:2024/docs

## Why Separate Installation?

The `langgraph-studio` Python package is deprecated and has version conflicts with FastAPI. Instead:
1. Use `langgraph-cli` which is the new official way to run LangGraph Studio
2. Install it separately (not in requirements.txt) to avoid dependency conflicts
3. The CLI provides a complete development server with Studio integration

## Features
- Visual workflow debugging
- Real-time execution monitoring
- Interactive graph exploration
- State inspection
- Step-by-step execution

## Notes
- The server runs on port 2024 by default (configurable with --port)
- Hot reload is enabled for development
- In-memory runtime is used for local development
- For production, use LangGraph Platform instead

## Troubleshooting
If you encounter issues:
1. Ensure Docker Desktop is running (required for Studio)
2. Check that port 2024 is not in use
3. Verify the workflow function accepts RunnableConfig parameter
4. Restart the server if configuration changes aren't detected