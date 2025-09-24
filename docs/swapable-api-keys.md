Supporting Hot-Swappable API Keys for Each Provider

OpenAI API – Per-Request API Key Support

OpenAI’s API is stateless with respect to API keys, meaning each request carries its own key. The OpenAI documentation confirms that every API call must include your API key in the HTTP Authorization header using the Bearer schema (e.g. Authorization: Bearer YOUR_OPENAI_KEY) ￼. This ensures you can use different keys on a per-request basis without needing a single global key. In practice, when using the OpenAI Python SDK, you can set the key at runtime (for example via openai.api_key or passing an api_key parameter) instead of relying on a fixed environment variable. The LangChain ChatOpenAI integration even allows providing an api_key when instantiating the client (as an alternative to env vars) ￼. Therefore, it’s entirely possible to swap API keys for each request – you can initialize separate OpenAI client instances with different keys (or update the key in a request’s context) for multi-tenant support. The key just needs to be included in the request headers for each call ￼.

Implementation tip: Remove any global singleton usage of settings.openai_api_key. Instead, thread the user’s OpenAI key through the request/worker context and supply it in the API call. For example, if using the OpenAI SDK directly, set the Authorization header or openai.api_key before each request. If using LangChain’s ChatOpenAI, create the model instance with the user’s key (or reuse a cached instance keyed by that API key) so that downstream calls use the correct credentials. Since OpenAI’s startup doesn’t require a default key when one is provided with the request, you can safely launch the worker with no global OpenAI key – just ensure each enterprise request carries a valid key. (OpenAI’s own best-practice is to load keys from secure config or env vars ￼, but here the key will come from the user’s input or stored secret.)

Tavily API – Dynamic Key per Request

Tavily – a web search and content extraction API – similarly supports per-request API keys. The Tavily documentation states that each request must include an Authorization header with the Tavily API key as a Bearer token (format: Authorization: Bearer tvly-YOUR_API_KEY) ￼. This means your FastAPI worker can accept a Tavily API key from the user and pass it along with each HTTP request to Tavily’s endpoints, without needing a single hard-coded key. In code, Tavily’s Python SDK allows you to instantiate a TavilyClient with a specified API key string ￼ – which you can do on a per-request basis or reuse cached client instances per key. For example:

from tavily import TavilyClient
tavily_client = TavilyClient(api_key="tvly-<USER_API_KEY>")
results = tavily_client.search("Your query here")

This approach avoids any reliance on a process-level default key. At startup, no Tavily key is required; the worker can initialize without failing key validation, as long as requests supply the key when needed. Just like with OpenAI, ensure that the user-provided Tavily key is injected into the request headers or client config each time. Tavily’s API will authenticate the call based on that header ￼. (Also implement safeguards: do not log these keys and strip them from debug outputs, given they are sensitive credentials.)

Perplexity API – Using User-Specific Keys Per Call

Perplexity AI provides an API for search/Q&A, and it too uses API keys passed in each request. According to Perplexity’s API docs, all requests must include an Authorization header with a Bearer token representing your Perplexity API key ￼. For example, a curl call to Perplexity’s Search API looks like:

curl --request POST https://api.perplexity.ai/search \
  --header "Authorization: Bearer <USER_PPLX_KEY>" \
  --header "Content-Type: application/json" \
  --data '{ "query": "…"}'

Each enterprise user can have their own Perplexity API token (keys typically starting with pplx- ￼) which your system can dynamically include on their requests. In implementation, if using Perplexity’s Python SDK (pip install perplexityai), you normally set an environment var PERPLEXITY_API_KEY or let the client read from it ￼ ￼. For a multi-tenant scenario, you should override that on a per-request basis. This might involve instantiating the Perplexity client with a specific key or configuring a custom header on each call. The key point is that the Perplexity API does not require a single static key at startup – the worker can launch without any default and simply pass the user’s key in the call. As long as the Authorization: Bearer ... header is set appropriately per request, Perplexity will accept it ￼. Make sure to handle invalid keys (the API will return 401 Unauthorized if the key is wrong or revoked), and fail fast for bad user keys without affecting other requests.

Best Practices and Additional Considerations

Implementing hot-swappable API keys requires careful handling beyond just passing the key string. Here are a few best practices to follow:
	•	Client Instance Caching: To avoid re-initializing clients on every request (which could add overhead), maintain a registry or cache of client objects keyed by (provider, api_key, model) as planned. For example, reuse an OpenAI or ChatOpenAI client if the same user key and model are requested again, but be sure to evict old/unused keys over time to prevent memory bloat.
	•	Startup Key Validation: Loosen any startup checks that previously required global API keys. The worker should start even if no default OpenAI/Tavily/Perplexity key is configured, since in an enterprise scenario each request brings its own credentials. Update or disable functions like validate_required_settings() that would abort on missing keys. Instead, perhaps log a warning if no system key is present, but allow operation ￼.
	•	Per-Request Context: Ensure that when a request comes in with user-supplied keys, those credentials are propagated to every part of the LangGraph execution. That means if the LangGraph involves multiple nodes (e.g. an LLM call, a web search step, etc.), each of those should draw the API key from the execution state or request config rather than any global settings. For instance, if using LangChain’s RunnableConfig, include the keys in that config so that all tools/LLMs use them.
	•	Security: Never log the raw API keys or expose them in responses. Strip keys from any error messages, and avoid accidentally caching them in places like task queues or traces. Use secure storage (encrypted DB fields via the userApiKeys system as mentioned) for at-rest keys, and only decrypt them in memory when needed for a request. All three providers use standard bearer tokens, so treat them like passwords (store hashed or encrypted, and do not embed them in client-side code or URLs).
	•	Validation of Keys: It’s wise to validate user-supplied keys quickly (with a lightweight test call) when they’re first provided or saved. Each provider might offer a cheap call or a specific endpoint to verify the key. For example, OpenAI keys can be test-verified by a quick model list fetch or a zero-token request, and will return an error if invalid. Tavily/Perplexity similarly will error on bad auth. By testing keys upfront (with short timeouts), you can give users immediate feedback (✅ valid / ❌ invalid in the UI) and avoid using invalid keys in a long multi-step workflow.

By confirming through official docs that OpenAI, Tavily, and Perplexity all accept API keys on a per-request basis, we can confidently refactor the LangGraph worker to support multi-tenant “bring your own key” usage. Each request can carry its own OpenAI/Tavily/Perplexity credentials and the worker will route them accordingly, enabling enterprise users to use their keys (bypassing credit limits) while still allowing non-enterprise users to default to the system’s keys when no override is provided. This meets the goal of hot-swappable provider keys with no service restart required when keys change, and full end-to-end validation that the correct key is used for each user’s request.

Sources:
	•	OpenAI API Authentication (per-request Bearer token) ￼; OpenAI Python integration for providing api_key programmatically ￼.
	•	Tavily API Key usage (Bearer token header and client instantiation) ￼ ￼.
	•	Perplexity API Key usage (Bearer token in Authorization header) ￼.