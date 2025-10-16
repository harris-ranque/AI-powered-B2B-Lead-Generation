# 🎨 LangGraph Studio & Integration Testing Guide

Complete guide for visualizing and testing the LangGraph email generation workflow.

## 🎯 Overview

This guide shows you how to:

1. **Visualize** the workflow in LangGraph Studio UI
2. **Run comprehensive tests** with detailed logging
3. **Debug** workflow execution step-by-step
4. **Monitor** performance and agent interactions

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install LangGraph CLI (if not already installed)
pip install langgraph-cli

# Or install all requirements
pip install -r requirements.txt
```

### 2. Launch LangGraph Studio

```bash
# Easy launcher with setup
python launch_langgraph_studio.py

# Or manually
langgraph studio --port 3001
```

### 3. Access the UI

- **Studio URL**: http://localhost:3001
- **Workflow**: Select `email_generation` from dropdown
- **Visualization**: See complete agent workflow graph

### 4. Run Integration Tests

```bash
# Comprehensive test suite
python test_integration_comprehensive.py

# Quick workflow demo (no API calls)
python test_workflow_demo.py
```

## 🎨 LangGraph Studio Features

### Visual Workflow Editor

- **Graph Visualization**: See all agents and connections
- **Interactive Nodes**: Click to inspect agent details
- **State Flow**: Track data flow between agents
- **Real-time Updates**: Watch workflow execution live

### Debugging Tools

- **Step-by-Step Execution**: Run workflow node by node
- **State Inspection**: View state at each step
- **Agent Outputs**: See individual agent results
- **Error Tracking**: Debug failed executions

### Testing Interface

- **Input Editor**: Provide custom test data
- **Output Viewer**: See formatted results
- **Performance Metrics**: Track execution times
- **Confidence Scores**: Monitor agent confidence

## 📊 Workflow Architecture

Our email generation workflow consists of:

```
START → Supervisor → Relevance Analyzer → Supervisor → Pain Point Researcher →
Supervisor → Value Matcher → Supervisor → Email Writer → Supervisor →
Follow-up Strategist (optional) → Supervisor → Aggregator → Supervisor → END
```

### Agent Roles:

1. **Supervisor**: Routes between agents based on workflow stage
2. **Relevance Analyzer**: Evaluates lead fit and qualification
3. **Pain Point Researcher**: Identifies customer challenges
4. **Value Matcher**: Aligns solutions to problems
5. **Email Writer**: Creates personalized email content
6. **Follow-up Strategist**: Plans email sequences (optional)
7. **Aggregator**: Compiles final results and recommendations

## 🧪 Integration Testing Suite

### Test Scenarios

#### 1. High Relevance Lead

- **Company**: TechScale Solutions (B2B SaaS)
- **Expected**: High relevance score, detailed email
- **Agents**: All agents should execute successfully

#### 2. Medium Relevance Lead

- **Company**: Creative Design Studio (Services)
- **Expected**: Medium relevance, simpler email
- **Agents**: Standard workflow execution

#### 3. Low Relevance Lead

- **Company**: Local Hardware Store (Retail)
- **Expected**: Low relevance, basic template
- **Agents**: May skip advanced personalization

#### 4. Error Handling

- **Purpose**: Test error recovery and graceful failure
- **Expected**: Proper error handling, minimal results

#### 5. Follow-up Sequence

- **Company**: Enterprise Corp (Large)
- **Expected**: Multi-email sequence generation
- **Agents**: Includes Follow-up Strategist

### Test Outputs

Each test provides detailed logging:

```
2025-08-17 15:30:45.123 | INFO  | [REQUEST] 🚀 Sending email generation request...
2025-08-17 15:30:47.456 | INFO  | [RESPONSE] ⏱️ Request completed in 2.33 seconds
2025-08-17 15:30:47.457 | INFO  | [RESULT] 📧 EMAIL GENERATION COMPLETED
2025-08-17 15:30:47.458 | INFO  | [RESULT]    Relevance Score: 0.85
2025-08-17 15:30:47.459 | INFO  | [RESULT]    Agents Executed: 6
2025-08-17 15:30:47.460 | INFO  | [RESULT]      1. Relevance Analyzer - Confidence: 0.92, Time: 0.45s
2025-08-17 15:30:47.461 | INFO  | [RESULT]      2. Pain Point Researcher - Confidence: 0.88, Time: 0.52s
```

## 🔍 Debugging Guide

### Common Issues

#### 1. "unhashable type: 'dict'" Error

- **Cause**: State serialization issues
- **Fix**: Ensure datetime objects are stored as strings
- **Status**: ✅ Fixed in latest version

#### 2. JSON Serialization Errors

- **Cause**: Webhook datetime serialization
- **Fix**: Use `model_dump(mode='json')`
- **Status**: ✅ Fixed in latest version

#### 3. Routing Failures

- **Cause**: Supervisor returning wrong type
- **Fix**: Separate node function from router function
- **Status**: ✅ Fixed in latest version

### Debug Workflow

1. **Check Health**: `curl http://localhost:8080/health`
2. **Test Agents Info**: `curl -H "Authorization: Bearer test-api-key" http://localhost:8080/agents/info`
3. **Run Simple Analysis**: Use `/analyze-lead` endpoint
4. **Full Workflow**: Use `/generate-email` endpoint
5. **Studio Visualization**: Watch execution in real-time

## 📈 Performance Monitoring

### Key Metrics

- **Total Processing Time**: End-to-end workflow duration
- **Agent Execution Times**: Individual agent performance
- **Confidence Scores**: Agent result quality
- **Memory Usage**: System resource consumption
- **Success Rate**: Workflow completion rate

### Optimization Tips

- Monitor relevance analyzer performance (often bottleneck)
- Track OpenAI API response times
- Watch memory usage for large workflows
- Optimize prompt lengths for faster responses

## 🛠️ Configuration

### LangGraph Studio Config (`langgraph.json`)

```json
{
  "dependencies": ["."],
  "graphs": {
    "email_generation": "app.langgraph.workflow:create_email_generation_workflow"
  },
  "env": ".env"
}
```

### Environment Variables (`.env`)

```bash
API_KEY=test-api-key
OPENAI_API_KEY=your-openai-key
PORT=8080
WEBHOOK_URL=http://localhost:3000/api/webhook
```

## 🎯 Testing Workflows

### 1. Visual Testing in Studio

```bash
# Launch studio
python launch_langgraph_studio.py

# In browser (http://localhost:3001):
# 1. Select "email_generation" workflow
# 2. Click "Input" and paste sample data
# 3. Click "Run" to execute
# 4. Watch nodes execute in real-time
# 5. Inspect state at each step
```

### 2. Automated Testing

```bash
# Full test suite (requires OpenAI API key)
python test_integration_comprehensive.py

# Demo workflow (no API calls needed)
python test_workflow_demo.py
```

### 3. Manual API Testing

```bash
# Health check
curl http://localhost:8080/health

# Lead analysis
curl -X POST http://localhost:8080/analyze-lead \
  -H "Authorization: Bearer test-api-key" \
  -H "Content-Type: application/json" \
  -d @test_lead.json

# Full email generation
curl -X POST http://localhost:8080/generate-email \
  -H "Authorization: Bearer test-api-key" \
  -H "Content-Type: application/json" \
  -d @test_request.json
```

## 📋 Sample Test Data

### High-Quality Lead

```json
{
  "id": "demo-lead-001",
  "company_name": "TechScale Solutions",
  "contact_name": "Sarah Rodriguez",
  "email": "sarah@techscale.com",
  "industry": "B2B SaaS",
  "company_size": "50-100",
  "location": "San Francisco, CA",
  "description": "Fast-growing B2B SaaS company providing project management solutions..."
}
```

### Business Profile

```json
{
  "company_name": "Genni AI",
  "industry": "AI/Technology",
  "value_proposition": "AI-powered lead generation and email personalization",
  "services": ["Lead Generation", "Email Automation", "AI Personalization"],
  "target_markets": ["B2B SaaS", "Technology Companies"],
  "key_differentiators": ["Multi-agent AI system", "Real-time personalization"]
}
```

## 🚀 Next Steps

1. **Explore Studio**: Play with different input data
2. **Monitor Performance**: Track execution times and success rates
3. **Debug Issues**: Use step-by-step execution for troubleshooting
4. **Optimize Workflow**: Improve agent prompts and routing logic
5. **Scale Testing**: Run comprehensive test suites regularly

---

## 🎉 Ready to Go!

Your LangGraph workflow is now ready for visual debugging and comprehensive testing. Launch the studio and start exploring! 🚀
