# 🧪 LangGraph Testing & Visualization Suite

Complete testing and visualization setup for the LangGraph email generation workflow.

## 🎯 What's Included

### 🎨 LangGraph Studio (Visual UI)
- **Visual workflow editor** with interactive graph
- **Real-time execution** monitoring  
- **Step-by-step debugging** capabilities
- **State inspection** at each node

### 🧪 Test Suites
1. **Demo Test** - No API calls, pure workflow validation
2. **Integration Test** - Comprehensive testing without OpenAI credits
3. **OpenAI Verification** - Full workflow with real AI responses

### 📊 Detailed Logging
- Step-by-step execution tracking
- Agent performance metrics
- Confidence scores and timing
- Error handling and recovery

## 🚀 Quick Start

### 1. Launch LangGraph Studio (Visual UI)
```bash
# Easy launcher with setup
python launch_langgraph_studio.py

# Then open: http://localhost:3001
# Select "email_generation" workflow
```

### 2. Run Demo Test (No Credits)
```bash
# Creates workflow and sample data
python test_workflow_demo.py
```

### 3. Run Integration Tests
```bash
# Comprehensive testing (may fail on OpenAI quota)
python test_integration_comprehensive.py
```

### 4. Run OpenAI Verification (Uses Credits)
```bash
# Full workflow with real OpenAI API calls
python test_with_openai_credits.py
```

## 🎨 LangGraph Studio Features

### Visual Workflow
```
START → Supervisor → Relevance Analyzer → Supervisor → Pain Point Researcher → 
Supervisor → Value Matcher → Supervisor → Email Writer → Supervisor → 
Aggregator → Supervisor → END
```

### Interactive Features
- **Node Inspection**: Click any agent to see details
- **State Visualization**: View data flow between agents  
- **Execution Tracking**: Watch workflow run in real-time
- **Input/Output Editor**: Test with custom data

### Debug Tools
- **Step-by-step execution**: Run one node at a time
- **State inspection**: See state at each step
- **Error tracking**: Debug failed executions
- **Performance metrics**: Monitor execution times

## 📋 Test Data Examples

### High-Quality Lead (Good for Testing)
```json
{
  "company_name": "CloudScale Technologies",
  "industry": "Cloud Infrastructure", 
  "company_size": "100-250",
  "description": "Rapidly growing cloud infrastructure company serving Fortune 500 clients..."
}
```

### Business Profile
```json
{
  "company_name": "Genni AI",
  "value_proposition": "AI-powered lead generation with 300% conversion improvement",
  "services": ["AI Lead Generation", "Email Personalization", "Sales Automation"]
}
```

## 🧪 Test Suite Details

### 1. Demo Test (`test_workflow_demo.py`)
- ✅ **No API calls** - Safe to run anytime
- ✅ **Workflow validation** - Ensures structure is correct
- ✅ **Sample data generation** - Creates test data for Studio
- ✅ **Configuration setup** - Prepares LangGraph Studio

**Output**: 
```
✅ Workflow created successfully!
📊 Workflow type: <class 'langgraph.graph.state.CompiledStateGraph'>
💾 LangGraph configuration saved to langgraph.json
```

### 2. Integration Test (`test_integration_comprehensive.py`)
- 🔍 **Health checks** - Server and service validation
- 📊 **Workflow info** - Agent and engine information  
- 🧪 **Multiple scenarios** - High/medium/low relevance testing
- ⚡ **Performance metrics** - Execution timing and success rates

**Test Scenarios**:
- **High Relevance**: B2B SaaS company (should score 0.8+)
- **Medium Relevance**: Creative agency (should score 0.5-0.7)  
- **Low Relevance**: Local hardware store (should score <0.5)
- **Error Handling**: Tests recovery and graceful failure

### 3. OpenAI Verification (`test_with_openai_credits.py`)
- 💳 **Uses real OpenAI credits** - Full workflow validation
- 🤖 **All agents execute** - Complete 7-agent workflow
- 📧 **Email generation** - Actual personalized email output
- 📊 **Detailed results** - Comprehensive success metrics

**Verification Steps**:
1. OpenAI API key validation
2. Server startup with AI connection
3. Lead analysis with real AI
4. Full email generation workflow
5. Detailed result analysis

## 📊 Sample Output Logs

### Integration Test Output
```
2025-08-17 15:30:45.123 | INFO  | [REQUEST] 🚀 Sending email generation request...
2025-08-17 15:30:47.456 | INFO  | [RESPONSE] ⏱️ Request completed in 2.33 seconds
2025-08-17 15:30:47.457 | INFO  | [RESULT] 📧 EMAIL GENERATION COMPLETED
2025-08-17 15:30:47.458 | INFO  | [RESULT]    Relevance Score: 0.85
2025-08-17 15:30:47.459 | INFO  | [RESULT]    Agents Executed: 6
2025-08-17 15:30:47.460 | INFO  | [RESULT]      1. Relevance Analyzer - Confidence: 0.92, Time: 0.45s
2025-08-17 15:30:47.461 | INFO  | [RESULT]      2. Pain Point Researcher - Confidence: 0.88, Time: 0.52s
```

### OpenAI Test Output  
```
🎉 EMAIL GENERATION SUCCESSFUL!
📊 WORKFLOW METRICS:
   Relevance Score: 0.847
   Total Processing Time: 12.34s
🤖 AGENT EXECUTION (6 agents):
    1. Relevance Analyzer    | Confidence: 0.925 | Time: 2.15s
    2. Pain Point Researcher | Confidence: 0.883 | Time: 2.87s
📧 GENERATED EMAIL:
   Subject: Transform CloudScale's Lead Generation with AI-Powered 300% Conversion Boost
   Effectiveness Score: 0.891
```

## 🔧 Configuration Files

### `langgraph.json` (Auto-generated)
```json
{
  "dependencies": ["."],
  "graphs": {
    "email_generation": "app.langgraph.workflow:create_email_generation_workflow"
  },
  "env": ".env"
}
```

### `.env` (Required)
```bash
API_KEY=test-api-key
OPENAI_API_KEY=your-openai-key  # For OpenAI tests
PORT=8080
WEBHOOK_URL=http://localhost:3000/api/webhook
```

## 🎯 Usage Scenarios

### 1. Development & Debugging
```bash
# Visual debugging in Studio
python launch_langgraph_studio.py
# Open http://localhost:3001, test with sample data
```

### 2. CI/CD Testing
```bash
# Automated testing without credits
python test_integration_comprehensive.py
# Exit code 0 = success, 1 = failure
```

### 3. Production Validation
```bash
# Full OpenAI workflow verification
python test_with_openai_credits.py
# Confirms real AI integration works
```

### 4. Performance Monitoring
```bash
# Track workflow performance over time
python test_integration_comprehensive.py > test_$(date +%Y%m%d_%H%M%S).log
```

## 📈 Success Metrics

### Integration Test Success Criteria
- ✅ **Health Check**: Server responds with "healthy" status
- ✅ **Workflow Info**: All 7 agents are configured correctly
- ✅ **Lead Analysis**: Returns relevance scores and assessments
- ✅ **Email Generation**: Completes workflow (may have OpenAI errors)

### OpenAI Test Success Criteria  
- ✅ **API Key**: Valid OpenAI API key with available credits
- ✅ **Lead Analysis**: Real AI analysis with confidence scores >0.7
- ✅ **Email Generation**: Complete personalized email with effectiveness >0.8
- ✅ **Agent Execution**: All agents complete successfully

## 🛠️ Troubleshooting

### Common Issues

#### "OpenAI quota exceeded"
- **Issue**: API credits exhausted
- **Solution**: Add credits to OpenAI account or use demo tests

#### "Server failed to start"
- **Issue**: Port 8080 in use or dependency missing
- **Solution**: Kill existing processes, check requirements.txt

#### "Workflow compilation failed"
- **Issue**: LangGraph configuration error
- **Solution**: Run `python test_workflow_demo.py` to regenerate config

#### "No agents info returned"
- **Issue**: Authentication or server error
- **Solution**: Check API_KEY in .env file

### Debug Steps
1. **Check Health**: `curl http://localhost:8080/health`
2. **Verify Config**: Ensure `langgraph.json` exists
3. **Test Auth**: `curl -H "Authorization: Bearer test-api-key" http://localhost:8080/agents/info`
4. **Run Demo**: `python test_workflow_demo.py`
5. **Visual Debug**: Launch LangGraph Studio

## 🎉 Ready to Test!

Your LangGraph workflow now has comprehensive testing and visualization capabilities:

1. **🎨 Visual debugging** with LangGraph Studio
2. **🧪 Automated testing** with detailed logging  
3. **💳 OpenAI verification** with real AI responses
4. **📊 Performance monitoring** with metrics and timing

Choose your testing approach and start exploring! 🚀