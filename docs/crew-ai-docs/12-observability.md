# Observability

> Monitor, evaluate, and optimize your CrewAI agents with comprehensive observability tools

## Observability for CrewAI

Observability is crucial for understanding how your CrewAI agents perform, identifying bottlenecks, and ensuring reliable operation in production environments. This section covers various tools and platforms that provide monitoring, evaluation, and optimization capabilities for your agent workflows.

## Why Observability Matters

* **Performance Monitoring**: Track agent execution times, token usage, and resource consumption
* **Quality Assurance**: Evaluate output quality and consistency across different scenarios
* **Debugging**: Identify and resolve issues in agent behavior and task execution
* **Cost Management**: Monitor LLM API usage and associated costs
* **Continuous Improvement**: Gather insights to optimize agent performance over time

## Available Observability Tools

### Monitoring & Tracing Platforms

<CardGroup cols={2}>
  <Card title="AgentOps" icon="paperclip" href="/en/observability/agentops">
    Session replays, metrics, and monitoring for agent development and production.
  </Card>

  <Card title="OpenLIT" icon="magnifying-glass-chart" href="/en/observability/openlit">
    OpenTelemetry-native monitoring with cost tracking and performance analytics.
  </Card>

  <Card title="MLflow" icon="bars-staggered" href="/en/observability/mlflow">
    Machine learning lifecycle management with tracing and evaluation capabilities.
  </Card>

  <Card title="Langfuse" icon="link" href="/en/observability/langfuse">
    LLM engineering platform with detailed tracing and analytics.
  </Card>

  <Card title="Langtrace" icon="chart-line" href="/en/observability/langtrace">
    Open-source observability for LLMs and agent frameworks.
  </Card>

  <Card title="Arize Phoenix" icon="meteor" href="/en/observability/arize-phoenix">
    AI observability platform for monitoring and troubleshooting.
  </Card>

  <Card title="Portkey" icon="key" href="/en/observability/portkey">
    AI gateway with comprehensive monitoring and reliability features.
  </Card>

  <Card title="Opik" icon="meteor" href="/en/observability/opik">
    Debug, evaluate, and monitor LLM applications with comprehensive tracing.
  </Card>

  <Card title="Weave" icon="network-wired" href="/en/observability/weave">
    Weights & Biases platform for tracking and evaluating AI applications.
  </Card>
</CardGroup>

### Evaluation & Quality Assurance

<CardGroup cols={2}>
  <Card title="Patronus AI" icon="shield-check" href="/en/observability/patronus-evaluation">
    Comprehensive evaluation platform for LLM outputs and agent behaviors.
  </Card>
</CardGroup>

## Key Observability Metrics

### Performance Metrics

* **Execution Time**: How long agents take to complete tasks
* **Token Usage**: Input/output tokens consumed by LLM calls
* **API Latency**: Response times from external services
* **Success Rate**: Percentage of successfully completed tasks

### Quality Metrics

* **Output Accuracy**: Correctness of agent responses
* **Consistency**: Reliability across similar inputs
* **Relevance**: How well outputs match expected results
* **Safety**: Compliance with content policies and guidelines

### Cost Metrics

* **API Costs**: Expenses from LLM provider usage
* **Resource Utilization**: Compute and memory consumption
* **Cost per Task**: Economic efficiency of agent operations
* **Budget Tracking**: Monitoring against spending limits

## Getting Started

1. **Choose Your Tools**: Select observability platforms that match your needs
2. **Instrument Your Code**: Add monitoring to your CrewAI applications
3. **Set Up Dashboards**: Configure visualizations for key metrics
4. **Define Alerts**: Create notifications for important events
5. **Establish Baselines**: Measure initial performance for comparison
6. **Iterate and Improve**: Use insights to optimize your agents

## Best Practices

### Development Phase

* Use detailed tracing to understand agent behavior
* Implement evaluation metrics early in development
* Monitor resource usage during testing
* Set up automated quality checks

### Production Phase

* Implement comprehensive monitoring and alerting
* Track performance trends over time
* Monitor for anomalies and degradation
* Maintain cost visibility and control

### Continuous Improvement

* Regular performance reviews and optimization
* A/B testing of different agent configurations
* Feedback loops for quality improvement
* Documentation of lessons learned

## AgentOps Integration

### Introduction

Observability is a key aspect of developing and deploying conversational AI agents. It allows developers to understand how their agents are performing, how their agents are interacting with users, and how their agents use external tools and APIs. AgentOps is a product independent of CrewAI that provides a comprehensive observability solution for agents.

### AgentOps Overview

[AgentOps](https://agentops.ai/?=crew) provides session replays, metrics, and monitoring for agents.

At a high level, AgentOps gives you the ability to monitor cost, token usage, latency, agent failures, session-wide statistics, and more. For more info, check out the [AgentOps Repo](https://github.com/AgentOps-AI/agentops).

AgentOps provides monitoring for agents in development and production. It provides a dashboard for tracking agent performance, session replays, and custom reporting.

Additionally, AgentOps provides session drilldowns for viewing Crew agent interactions, LLM calls, and tool usage in real-time. This feature is useful for debugging and understanding how agents interact with users as well as other agents.

### Features

* **LLM Cost Management and Tracking**: Track spend with foundation model providers.
* **Replay Analytics**: Watch step-by-step agent execution graphs.
* **Recursive Thought Detection**: Identify when agents fall into infinite loops.
* **Custom Reporting**: Create custom analytics on agent performance.
* **Analytics Dashboard**: Monitor high-level statistics about agents in development and production.
* **Public Model Testing**: Test your agents against benchmarks and leaderboards.
* **Custom Tests**: Run your agents against domain-specific tests.
* **Time Travel Debugging**: Restart your sessions from checkpoints.
* **Compliance and Security**: Create audit logs and detect potential threats such as profanity and PII leaks.
* **Prompt Injection Detection**: Identify potential code injection and secret leaks.

### Using AgentOps

<Steps>
  <Step title="Create an API Key">
    Create a user API key here: [Create API Key](https://app.agentops.ai/account)
  </Step>

  <Step title="Configure Your Environment">
    Add your API key to your environment variables:

    ```bash
    AGENTOPS_API_KEY=<YOUR_AGENTOPS_API_KEY>
    ```
  </Step>

  <Step title="Install AgentOps">
    Install AgentOps with:

    ```bash
    pip install 'crewai[agentops]'
    ```

    or

    ```bash
    pip install agentops
    ```
  </Step>

  <Step title="Initialize AgentOps">
    Before using `Crew` in your script, include these lines:

    ```python
    import agentops
    agentops.init()
    ```

    This will initiate an AgentOps session as well as automatically track Crew agents. For further info on how to outfit more complex agentic systems, check out the [AgentOps documentation](https://docs.agentops.ai) or join the [Discord](https://discord.gg/j4f3KbeH).
  </Step>
</Steps>

## Arize Phoenix Integration

Arize Phoenix integration for CrewAI with OpenTelemetry and OpenInference provides tracing and evaluation for AI applications.

### Get Started

1. **Install Dependencies**:
   ```bash
   pip install openinference-instrumentation-crewai crewai crewai-tools arize-phoenix-otel
   ```

2. **Set Up Environment Variables**:
   Configure Phoenix Cloud API keys and OpenTelemetry to send traces to Phoenix.

3. **Initialize OpenTelemetry with Phoenix**:
   ```python
   from phoenix.otel import register
   
   tracer_provider = register(
       project_name="crewai-tracing-demo",
       auto_instrument=True,
   )
   ```

4. **Create a CrewAI Application** with instrumentation enabled.

5. **View Traces in Phoenix** - Log into your Phoenix Cloud account to see detailed agent interactions and LLM calls.

## OpenLIT Integration

[OpenLIT](https://github.com/openlit/openlit?src=crewai-docs) is an open-source tool that makes it simple to monitor the performance of AI agents, LLMs, VectorDBs, and GPUs with just **one** line of code.

### Setup Steps

1. **Deploy OpenLIT**:
   ```bash
   git clone https://github.com/openlit/openlit.git
   cd openlit
   docker compose up -d
   ```

2. **Install OpenLIT SDK**:
   ```bash
   pip install openlit
   ```

3. **Initialize OpenLIT in Your Application**:
   ```python
   import openlit
   
   openlit.init()
   ```

4. **Access Dashboard** at `127.0.0.1:3000` with default credentials.

## Langfuse Integration

Langfuse is an open-source LLM engineering platform that provides tracing and monitoring capabilities for LLM applications.

### Integration Steps

1. **Install Dependencies**:
   ```bash
   pip install langfuse openlit crewai crewai_tools
   ```

2. **Set Up Environment Variables**:
   ```python
   import os
   
   os.environ["LANGFUSE_PUBLIC_KEY"] = "pk-lf-..."
   os.environ["LANGFUSE_SECRET_KEY"] = "sk-lf-..."
   os.environ["LANGFUSE_HOST"] = "https://cloud.langfuse.com"
   ```

3. **Configure OpenTelemetry** to send traces to Langfuse via OpenLit.

4. **Monitor Your Application** through the Langfuse dashboard.

Choose the observability tools that best fit your use case, infrastructure, and monitoring requirements to ensure your CrewAI agents perform reliably and efficiently.