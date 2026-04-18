import { defineTool } from '../../tool-module';
import type { ProviderWebContext } from '../../tool-module';
import { createWebSearchTool } from './web-search';

interface WebSearchContext {
  providerWeb?: ProviderWebContext;
  tavilyApiKey?: string;
}

/**
 * Web search. Three tiers, checked in order:
 *   1. A connected provider plugin that exports `webSearch`.
 *   2. Tavily, if an API key is configured.
 *   3. Built-in DuckDuckGo HTML scrape (always works, lowest quality).
 *
 * Because the built-in has a DuckDuckGo fallback, this module always
 * produces a usable tool — `create` never returns null.
 */
export default defineTool<WebSearchContext>({
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web',
  group: 'web',
  icon: 'search',
  classification: 'read-only',

  resolveContext: (config, runtime) => ({
    providerWeb: runtime.providerWeb,
    tavilyApiKey: config.tavilyApiKey || process.env.TAVILY_API_KEY,
  }),

  create: (ctx) => {
    if (ctx.providerWeb?.plugin.webSearch) {
      return ctx.providerWeb.plugin.webSearch.createTool({
        apiKey: ctx.providerWeb.apiKey,
        baseUrl: ctx.providerWeb.baseUrl,
      });
    }
    return createWebSearchTool({ tavilyApiKey: ctx.tavilyApiKey });
  },
});
