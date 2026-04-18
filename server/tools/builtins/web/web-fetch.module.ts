import { defineTool } from '../../tool-module';
import type { ProviderWebContext } from '../../tool-module';
import { createWebFetchTool } from './web-fetch';

interface WebFetchContext {
  providerWeb?: ProviderWebContext;
}

/**
 * Web fetch. Prefers a provider-plugin implementation when available
 * (e.g. OpenRouter's `webFetch`), otherwise falls back to the built-in
 * `createWebFetchTool()`. Always produces a tool — `create` never
 * returns null.
 */
export default defineTool<WebFetchContext>({
  name: 'web_fetch',
  label: 'Web Fetch',
  description: 'Fetch a URL and return its content',
  group: 'web',
  icon: 'globe',
  classification: 'read-only',

  resolveContext: (_config, runtime) => ({
    providerWeb: runtime.providerWeb,
  }),

  create: (ctx) => {
    if (ctx.providerWeb?.plugin.webFetch) {
      return ctx.providerWeb.plugin.webFetch.createTool({
        apiKey: ctx.providerWeb.apiKey,
        baseUrl: ctx.providerWeb.baseUrl,
      });
    }
    return createWebFetchTool();
  },
});
