# Tools

> Understanding and leveraging tools within the CrewAI framework for agent collaboration and task execution.

## Overview

CrewAI tools empower agents with capabilities ranging from web searching and data analysis to collaboration and delegating tasks among coworkers.
This documentation outlines how to create, integrate, and leverage these tools within the CrewAI framework, including a new focus on collaboration tools.

## What is a Tool?

A tool in CrewAI is a skill or function that agents can utilize to perform various actions.
This includes tools from the [CrewAI Toolkit](https://github.com/joaomdmoura/crewai-tools) and [LangChain Tools](https://python.langchain.com/docs/integrations/tools),
enabling everything from simple searches to complex interactions and effective teamwork among agents.

<Note type="info" title="Enterprise Enhancement: Tools Repository">
  CrewAI Enterprise provides a comprehensive Tools Repository with pre-built integrations for common business systems and APIs. Deploy agents with enterprise tools in minutes instead of days.

  The Enterprise Tools Repository includes:

  * Pre-built connectors for popular enterprise systems
  * Custom tool creation interface
  * Version control and sharing capabilities
  * Security and compliance features
</Note>

## Key Characteristics of Tools

* **Utility**: Crafted for tasks such as web searching, data analysis, content generation, and agent collaboration.
* **Integration**: Boosts agent capabilities by seamlessly integrating tools into their workflow.
* **Customizability**: Provides the flexibility to develop custom tools or utilize existing ones, catering to the specific needs of agents.
* **Error Handling**: Incorporates robust error handling mechanisms to ensure smooth operation.
* **Caching Mechanism**: Features intelligent caching to optimize performance and reduce redundant operations.
* **Asynchronous Support**: Handles both synchronous and asynchronous tools, enabling non-blocking operations.

## Using CrewAI Tools

To enhance your agents' capabilities with crewAI tools, begin by installing our extra tools package:

```bash
pip install 'crewai[tools]'
```

Here's an example demonstrating their use:

```python Code
import os
from crewai import Agent, Task, Crew
# Importing crewAI tools
from crewai_tools import (
    DirectoryReadTool,
    FileReadTool,
    SerperDevTool,
    WebsiteSearchTool
)

# Set up API keys
os.environ["SERPER_API_KEY"] = "Your Key" # serper.dev API key
os.environ["OPENAI_API_KEY"] = "Your Key"

# Instantiate tools
docs_tool = DirectoryReadTool(directory='./blog-posts')
file_tool = FileReadTool()
search_tool = SerperDevTool()
web_rag_tool = WebsiteSearchTool()

# Create agents
researcher = Agent(
    role='Market Research Analyst',
    goal='Provide up-to-date market analysis of the AI industry',
    backstory='An expert analyst with a keen eye for market trends.',
    tools=[search_tool, web_rag_tool],
    verbose=True
)

writer = Agent(
    role='Content Writer',
    goal='Craft engaging blog posts about the AI industry',
    backstory='A skilled writer with a passion for technology.',
    tools=[docs_tool, file_tool],
    verbose=True
)

# Define tasks
research = Task(
    description='Research the latest trends in the AI industry and provide a summary.',
    expected_output='A summary of the top 3 trending developments in the AI industry with a unique perspective on their significance.',
    agent=researcher
)

write = Task(
    description='Write an engaging blog post about the AI industry, based on the research analyst's summary. Draw inspiration from the latest blog posts in the directory.',
    expected_output='A 4-paragraph blog post formatted in markdown with engaging, informative, and accessible content, avoiding complex jargon.',
    agent=writer,
    output_file='blog-posts/new_post.md'  # The final blog post will be saved here
)

# Assemble a crew with planning enabled
crew = Crew(
    agents=[researcher, writer],
    tasks=[research, write],
    verbose=True,
    planning=True,  # Enable planning feature
)

# Execute tasks
crew.kickoff()
```

## Available CrewAI Tools

* **Error Handling**: All tools are built with error handling capabilities, allowing agents to gracefully manage exceptions and continue their tasks.
* **Caching Mechanism**: All tools support caching, enabling agents to efficiently reuse previously obtained results, reducing the load on external resources and speeding up the execution time. You can also define finer control over the caching mechanism using the `cache_function` attribute on the tool.

Here is a list of the available tools and their descriptions:

| Tool                             | Description                                                                                    |
| :------------------------------- | :--------------------------------------------------------------------------------------------- |
| **ApifyActorsTool**              | A tool that integrates Apify Actors with your workflows for web scraping and automation tasks. |
| **BrowserbaseLoadTool**          | A tool for interacting with and extracting data from web browsers.                             |
| **CodeDocsSearchTool**           | A RAG tool optimized for searching through code documentation and related technical documents. |
| **CodeInterpreterTool**          | A tool for interpreting python code.                                                           |
| **ComposioTool**                 | Enables use of Composio tools.                                                                 |
| **CSVSearchTool**                | A RAG tool designed for searching within CSV files, tailored to handle structured data.        |
| **DALL-E Tool**                  | A tool for generating images using the DALL-E API.                                             |
| **DirectorySearchTool**          | A RAG tool for searching within directories, useful for navigating through file systems.       |
| **DOCXSearchTool**               | A RAG tool aimed at searching within DOCX documents, ideal for processing Word files.          |
| **DirectoryReadTool**            | Facilitates reading and processing of directory structures and their contents.                 |
| **EXASearchTool**                | A tool designed for performing exhaustive searches across various data sources.                |
| **FileReadTool**                 | Enables reading and extracting data from files, supporting various file formats.               |
| **FirecrawlSearchTool**          | A tool to search webpages using Firecrawl and return the results.                              |
| **FirecrawlCrawlWebsiteTool**    | A tool for crawling webpages using Firecrawl.                                                  |
| **FirecrawlScrapeWebsiteTool**   | A tool for scraping webpages URL using Firecrawl and returning its contents.                   |
| **GithubSearchTool**             | A RAG tool for searching within GitHub repositories, useful for code and documentation search. |
| **SerperDevTool**                | A specialized tool for development purposes, with specific functionalities under development.  |
| **TXTSearchTool**                | A RAG tool focused on searching within text (.txt) files, suitable for unstructured data.      |
| **JSONSearchTool**               | A RAG tool designed for searching within JSON files, catering to structured data handling.     |
| **LlamaIndexTool**               | Enables the use of LlamaIndex tools.                                                           |
| **MDXSearchTool**                | A RAG tool tailored for searching within Markdown (MDX) files, useful for documentation.       |
| **PDFSearchTool**                | A RAG tool aimed at searching within PDF documents, ideal for processing scanned documents.    |
| **PGSearchTool**                 | A RAG tool optimized for searching within PostgreSQL databases, suitable for database queries. |
| **Vision Tool**                  | A tool for generating images using the DALL-E API.                                             |
| **RagTool**                      | A general-purpose RAG tool capable of handling various data sources and types.                 |
| **ScrapeElementFromWebsiteTool** | Enables scraping specific elements from websites, useful for targeted data extraction.         |
| **ScrapeWebsiteTool**            | Facilitates scraping entire websites, ideal for comprehensive data collection.                 |
| **WebsiteSearchTool**            | A RAG tool for searching website content, optimized for web data extraction.                   |
| **XMLSearchTool**                | A RAG tool designed for searching within XML files, suitable for structured data formats.      |
| **YoutubeChannelSearchTool**     | A RAG tool for searching within YouTube channels, useful for video content analysis.           |
| **YoutubeVideoSearchTool**       | A RAG tool aimed at searching within YouTube videos, ideal for video data extraction.          |

## Creating your own Tools

<Tip>
  Developers can craft `custom tools` tailored for their agent's needs or
  utilize pre-built options.
</Tip>

There are two main ways for one to create a CrewAI tool:

### Subclassing `BaseTool`

```python Code
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

class MyToolInput(BaseModel):
    """Input schema for MyCustomTool."""
    argument: str = Field(..., description="Description of the argument.")

class MyCustomTool(BaseTool):
    name: str = "Name of my tool"
    description: str = "What this tool does. It's vital for effective utilization."
    args_schema: Type[BaseModel] = MyToolInput

    def _run(self, argument: str) -> str:
        # Your tool's logic here
        return "Tool's result"
```

## Asynchronous Tool Support

CrewAI supports asynchronous tools, allowing you to implement tools that perform non-blocking operations like network requests, file I/O, or other async operations without blocking the main execution thread.

### Creating Async Tools

You can create async tools in two ways:

#### 1. Using the `tool` Decorator with Async Functions

```python Code
from crewai.tools import tool

@tool("fetch_data_async")
async def fetch_data_async(query: str) -> str:
    """Asynchronously fetch data based on the query."""
    # Simulate async operation
    await asyncio.sleep(1)
    return f"Data retrieved for {query}"
```

#### 2. Implementing Async Methods in Custom Tool Classes

```python Code
from crewai.tools import BaseTool

class AsyncCustomTool(BaseTool):
    name: str = "async_custom_tool"
    description: str = "An asynchronous custom tool"
    
    async def _run(self, query: str = "") -> str:
        """Asynchronously run the tool"""
        # Your async implementation here
        await asyncio.sleep(1)
        return f"Processed {query} asynchronously"
```

### Using Async Tools

Async tools work seamlessly in both standard Crew workflows and Flow-based workflows:

```python Code
# In standard Crew
agent = Agent(role="researcher", tools=[async_custom_tool])

# In Flow
class MyFlow(Flow):
    @start()
    async def begin(self):
        crew = Crew(agents=[agent])
        result = await crew.kickoff_async()
        return result
```

The CrewAI framework automatically handles the execution of both synchronous and asynchronous tools, so you don't need to worry about how to call them differently.

### Utilizing the `tool` Decorator

```python Code
from crewai.tools import tool
@tool("Name of my tool")
def my_tool(question: str) -> str:
    """Clear description for what this tool is useful for, your agent will need this information to use it."""
    # Function logic here
    return "Result from your custom tool"
```

### Custom Caching Mechanism

<Tip>
  Tools can optionally implement a `cache_function` to fine-tune caching
  behavior. This function determines when to cache results based on specific
  conditions, offering granular control over caching logic.
</Tip>

```python Code
from crewai.tools import tool

@tool
def multiplication_tool(first_number: int, second_number: int) -> str:
    """Useful for when you need to multiply two numbers together."""
    return first_number * second_number

def cache_func(args, result):
    # In this case, we only cache the result if it's a multiple of 2
    cache = result % 2 == 0
    return cache

multiplication_tool.cache_function = cache_func

writer1 = Agent(
        role="Writer",
        goal="You write lessons of math for kids.",
        backstory="You're an expert in writing and you love to teach kids but you know nothing of math.",
        tools=[multiplication_tool],
        allow_delegation=False,
    )
    #...
```

## Tools by Category

### File & Document Processing

Read, write, and search through various file formats including PDF, DOCX, JSON, CSV, and more. Perfect for document processing workflows.

**Available Tools:**
- **FileReadTool**: Read content from any file type
- **FileWriteTool**: Write content to files
- **PDFSearchTool**: Search and extract text from PDF documents
- **DOCXSearchTool**: Search through Microsoft Word documents
- **JSONSearchTool**: Parse and search through JSON files
- **CSVSearchTool**: Process and search through CSV files
- **XMLSearchTool**: Parse XML files and search for elements
- **MDXSearchTool**: Search through MDX files and documentation
- **TXTSearchTool**: Search through plain text files
- **DirectorySearchTool**: Search for files and folders
- **DirectoryReadTool**: Read and list directory contents

### Web Scraping & Browsing

Extract data from websites, automate browser interactions, and scrape content at scale.

**Available Tools:**
- **ScrapeWebsiteTool**: General-purpose web scraping
- **ScrapeElementFromWebsiteTool**: Target specific elements
- **FirecrawlCrawlWebsiteTool**: Crawl entire websites systematically
- **FirecrawlScrapeWebsiteTool**: High-performance web scraping
- **FirecrawlSearchTool**: Search and extract specific content
- **BrowserbaseLoadTool**: Cloud-based browser automation

### Search & Research

Perform web searches, find code repositories, research YouTube content, and discover information across the internet.

**Available Tools:**
- **SerperDevTool**: Google search API integration
- **EXASearchTool**: AI-powered search
- **GithubSearchTool**: Search GitHub repositories
- **WebsiteSearchTool**: Search within specific websites
- **CodeDocsSearchTool**: Search through code documentation
- **YoutubeChannelSearchTool**: Search YouTube channels
- **YoutubeVideoSearchTool**: Find and analyze YouTube videos

### Database & Data

Connect to SQL databases, vector stores, and data warehouses.

**Available Tools:**
- **PGSearchTool**: PostgreSQL database queries
- **MySQLTool**: MySQL database operations
- **SnowflakeSearchTool**: Access Snowflake data warehouse
- **QdrantVectorSearchTool**: Search vector embeddings
- **WeaviateVectorSearchTool**: Semantic search with Weaviate

### AI & Machine Learning

Generate images, process vision tasks, integrate with LangChain, build RAG systems, and leverage code interpreters.

**Available Tools:**
- **DallETool**: Generate AI images using DALL-E
- **VisionTool**: Process and analyze images
- **CodeInterpreterTool**: Execute Python code
- **LlamaIndexTool**: Build knowledge bases
- **RagTool**: Implement Retrieval-Augmented Generation

### Automation & Integration

Automate workflows with various integration platforms.

**Available Tools:**
- **ApifyActorsTool**: Web scraping and automation with Apify
- **ComposioTool**: Integration platform capabilities

## MCP Servers as Tools

CrewAI supports integration with MCP (Model Context Protocol) servers, allowing you to connect to external services and tools through standardized protocols.

### Supported Transport Mechanisms

- **Stdio**: For local servers (communication via standard input/output)
- **Server-Sent Events (SSE)**: For remote servers (real-time data streaming)
- **Streamable HTTP**: For remote servers (flexible bi-directional communication)

### Basic MCP Integration

```python
from crewai import Agent
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

# Configure MCP server
server_params = StdioServerParameters(
    command="python3",
    args=["servers/your_server.py"],
    env={"UV_PYTHON": "3.12", **os.environ},
)

# Use with context manager (recommended)
with MCPServerAdapter(server_params) as mcp_tools:
    agent = Agent(
        role="MCP Tool User",
        goal="Utilize tools from an MCP server",
        backstory="I can connect to MCP servers and use their tools",
        tools=mcp_tools,
        verbose=True
    )
```

### Security Considerations

<Warning>
  Always ensure that you trust an MCP Server before using it. MCP servers can execute code, access data, or interact with other systems.
</Warning>

Key security practices:
- Only connect to trusted MCP servers
- Validate Origin headers for SSE connections
- Use HTTPS for remote connections
- Implement proper authentication
- Follow the principle of least privilege

## Conclusion

Tools are pivotal in extending the capabilities of CrewAI agents, enabling them to undertake a broad spectrum of tasks and collaborate effectively.
When building solutions with CrewAI, leverage both custom and existing tools to empower your agents and enhance the AI ecosystem. Consider utilizing error handling,
caching mechanisms, and the flexibility of tool arguments to optimize your agents' performance and capabilities.