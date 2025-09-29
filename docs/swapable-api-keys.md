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

	Yes — the Google Maps / Places API also supports passing your API key per request, meaning you can in principle hot-swap keys on a per-request basis. Here are the key details and caveats you should know when integrating into a multi-tenant, hot-swappable architecture.

⸻

Google Maps / Places API — Per-Request Key Usage

Key-based authentication
	•	Google Maps Platform (including Places APIs) requires an API key to be included in each request to identify the project for billing/quota purposes.  ￼
	•	The key can be passed in two ways:
	1.	As a query parameter named key (e.g. ?key=YOUR_API_KEY) in the URL.  ￼
	2.	As an HTTP header X-Goog-Api-Key. Google’s documentation for using API keys with REST recommends x-goog-api-key for many Google APIs.  ￼
From the Google Cloud “Use API keys with REST” doc:
“To include an API key with a REST API call, use the x-goog-api-key HTTP header … If you can’t use the HTTP header, you can use the key query parameter.”  ￼
	•	For the Places API (New), Google shows example requests with the key query parameter, or using the header X-Goog-Api-Key.  ￼
	•	Also, many Google APIs support passing key in the query string because it is widely compatible, but Google encourages using the X-Goog-Api-Key header to avoid exposing the key in URLs.  ￼

Therefore, the Google Places API supports per-request key usage — you are not locked into a single static key at startup.

Implementation implications for hot swapping

Given that Google allows passing the key on every request, you can integrate it into your multi-key architecture. But there are some details and best practices to handle:
	•	Client instantiation or wrapper: You might wrap all Google Maps/Places API calls in a client (e.g. GooglePlacesClient) that is parameterized by api_key. For each request, you can either (a) instantiate a new client with that key or (b) reuse a cached client keyed by (provider, api_key, options).
	•	Header vs query parameter: Prefer using the X-Goog-Api-Key header so that the key isn’t exposed in the URL (or in logs) when possible. If a library doesn’t support headers, fallback to using key in the query string, but be more cautious about logging and URL exposur.
	•	Startup / default key: As with your other providers, relax any startup requirement that a default Google API key must be present. The worker should be able to launch without a default key. Only when a request includes a Google key (or fallback) should it validate its usage.
	•	Validation of keys: When a user submits their Google Maps API key, you should validate it (e.g. do a simple Places API call with limited scope) to detect an invalid key early. Use short timeouts so the validation doesn’t stall.
	•	Quotas and billing: Be aware that each key is tied to its own Google Cloud project and has quotas. In a multi-tenant scenario, you may need to monitor usage per key, enforce tenant-level rate limits, or guard against abuse.
	•	Client library support: Google’s client libraries often allow passing an API key (for example, via client_options={"api_key": key} in Python’s Google Cloud libraries) rather than relying solely on default application credentials. That pattern should allow you to integrate per-request keys. (Though, you’ll need to check for the specific Maps / Places library you use.)
	•	Security / logging: As with other keys, never log the raw Google key. Avoid accidentally including it in debug outputs or error messages.

Example request formats
	•	Using header:

GET https://places.googleapis.com/v1/places/PLACE_ID?fields=id,displayName
X-Goog-Api-Key: YOUR_API_KEY
Content-Type: application/json
X-Goog-FieldMask: id,displayName

(This is shown in Google’s documentation for Place Details (New) requests.)  ￼

	•	Or via query parameter:

GET https://places.googleapis.com/v1/places/ChIJj61dQgK6j4AR4GeTYWZsKWw?fields=id,displayName&key=YOUR_API_KEY

(In many examples, Google shows passing key=… in URL.)  ￼

Both forms are accepted by the API, so in your wrapper you can choose which you support (header first, fallback to query param).

⸻

Conclusion

Yes — Google Maps / Places API is compatible with your requirement of passing API keys per request (i.e. hot-swapped). You can embed the user’s Google key into each request either via the X-Goog-Api-Key header (preferred) or via the key query parameter. That makes it feasible to refactor your worker to support per-tenant, bring-your-own-key behavior for Google Maps/Places calls, just as you would for OpenAI, Tavily, etc.

Yes — based on available documentation, both Icypeas and Findymail (FindyMail) appear to support per-request API-key authentication. Below are the details I found, plus notes on caveats and how to integrate them into your multi-key architecture.

⸻

Icypeas

Support for per-request API key
Icypeas uses a simple API-key style authentication. Requests must include an Authorization header whose value is the API key (not “Bearer …”, but just the key) along with Content-Type: application/json.  ￼

From their docs:

Two headers are needed to run a query against the API:
	1.	Authorization header containing your API key (and ONLY your API key)
	2.	Content-Type header with value application/json  ￼

Example curl:

curl -H "Content-Type: application/json" \
     -H "Authorization: YOUR_API_KEY" \
     https://app.icypeas.com/api/email-search \
     -d '{ "firstname": "Pierre", "lastname": "Landoin", "domainOrCompany": "icypeas.com" }'

Thus, you can embed the user’s Icypeas API key in each call and the server will treat that as authentication. There is no indication that you must supply a global process-level key.

Caveats / additional notes
	•	The header is not a Bearer <token> style; it seems they expect just the API key in the Authorization header. (i.e. Authorization: YOUR_API_KEY)  ￼
	•	There is mention in “API authorization” docs about “signature” or additional authorization steps, but the primary method is via the key header.  ￼
	•	Make sure you don’t accidentally log the key, and treat it as a secret.
	•	Because the key is simple, any invalid key will likely produce an HTTP 401 or 403, so your system must handle that per request (fail that request, not the entire server).

Integration in your architecture
	•	In your LangGraph worker, when a request arrives with an Icypeas key, store it in the execution state (e.g. state["provider_keys"]["icypeas"] = <key>).
	•	Use a client factory or registry to instantiate an IcypeasClient (or wrapper) configured with that key. For example:

client = IcypeasClient(api_key=user_key)
client.email_search(...)


	•	Cache per (key, optional parameters) if desired, with eviction.
	•	In startup validation, don’t require a default Icypeas key. Only validate when a user-provided key is used.

Given that the API design is simple and key-based, Icypeas is compatible with your hot-swappable key architecture.

⸻

Findymail (FindyMail)

Support for API key per request / authentication method

From the Pipedream integration and other sources, Findymail uses API keys for authentication. That integration implies that you provide the key when configuring the connector, and underlying calls include it in requests.  ￼

While I could not find a public example in the official Findymail docs showing exactly how to pass the key (header name, “Bearer” prefix, etc.), the multiple integrations assert that API key authentication is used.  ￼

One integration library (Composio toolkit) describes using an “API key authentication” config for Findymail:

auth_config = {
  "auth_scheme": "API_KEY",
  "val": {
    "generic_api_key": user_api_key
  }
}

This suggests Findymail expects a generic API key in a standard header context.  ￼

Thus, it is highly likely that you can swap Findymail API keys per request, i.e. each request carries the user’s key.

Caveats / things to validate
	•	You must verify exactly which HTTP header and prefix Findymail expects (e.g. Authorization: Bearer <key> vs X-API-Key: <key> or Authorization: <key>). The integrations do not fully document that publically. As part of your implementation, test with a sample API call using different header schemes to confirm which form succeeds.
	•	Rate limiting, billing model, quotas for keys — check for how Findymail behaves when multiple keys from different users are hitting the same backend (you might need to monitor combined impact or enforce per-tenant rate limits).
	•	Handle invalid keys gracefully per-request (i.e. 401 responses) without bringing down or affecting other tenants.

Integration in your architecture
	•	As with other providers, carry state["provider_keys"]["findymail"] = <user_key> in your execution context.
	•	Use a client or HTTP wrapper that includes that key in the correct header for each call.
	•	Optionally cache client wrappers keyed by the user key.
	•	In startup validation logic, do not require a default Findymail key — only validate when a user key is used.
	•	In unit / integration tests, include scenarios with multiple user keys in the same process to confirm isolation.

⸻

Summary Table & Implementation Notes

Provider	Supports per-request key	Header / Format	Notes & Caveats
Icypeas	✅ Yes	Authorization: YOUR_API_KEY + Content-Type: application/json  ￼	No “Bearer” prefix; test error responses.
Findymail	✅ Very likely	Uses API key auth; header scheme unclear (likely Authorization or custom)  ￼	Must empirically test which header form is accepted.

Because both providers use API-key–based auth rather than long-lived session tokens or OAuth flows, they integrate well into your “hot-swap keys per request” model. As long as you dynamically insert the correct key into each HTTP request (or client instance), your architecture supports multi-tenant key swapping without needing process restarts.



