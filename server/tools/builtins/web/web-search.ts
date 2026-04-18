import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_SEC = 15;

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

// ---------------------------------------------------------------------------
// Tavily search (primary — requires API key)
// ---------------------------------------------------------------------------

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

async function searchTavily(params: {
  apiKey: string;
  query: string;
  maxResults: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: params.apiKey,
      query: params.query,
      max_results: params.maxResults,
      include_answer: true,
      search_depth: 'basic',
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Tavily API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as TavilyResponse;
  return formatSearchResults(
    data.results?.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })) ?? [],
    data.answer,
    'tavily',
  );
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML scrape (fallback — no API key needed)
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(params: {
  query: string;
  maxResults: number;
  signal?: AbortSignal;
}): Promise<string> {
  const url = `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(params.query)}`;
  const response = await fetch(url, { signal: params.signal });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${response.status}`);
  }

  const html = await response.text();
  const results = parseDdgHtml(html, params.maxResults);
  return formatSearchResults(results, undefined, 'duckduckgo');
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDdgHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  // Match result blocks: <a class="result__a" href="...">title</a> ... <a class="result__snippet">snippet</a>
  const resultBlockRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: { url: string; title: string }[] = [];
  let match;
  while ((match = resultBlockRe.exec(html)) !== null) {
    let url = match[1];
    // DDG wraps URLs in a redirect — extract the actual URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (title && url) {
      titles.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRe.exec(html)) !== null) {
    snippets.push(
      match[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim(),
    );
  }

  for (let i = 0; i < Math.min(titles.length, max); i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatSearchResults(
  results: SearchResult[],
  answer: string | undefined,
  provider: string,
): string {
  if (results.length === 0) {
    return `No results found. [provider: ${provider}]`;
  }

  const parts: string[] = [];

  if (answer) {
    parts.push(`Summary: ${answer}\n`);
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    parts.push(`${i + 1}. ${r.title}`);
    parts.push(`   ${r.url}`);
    if (r.snippet) {
      parts.push(`   ${r.snippet}`);
    }
    parts.push('');
  }

  parts.push(`[${results.length} results | provider: ${provider}]`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Tool context & factory
// ---------------------------------------------------------------------------

export interface WebSearchToolContext {
  /** Tavily API key. When empty, falls back to DuckDuckGo HTML scrape. */
  tavilyApiKey?: string;
}

export function createWebSearchTool(ctx: WebSearchToolContext): AgentTool<TSchema> {
  const hasTavily = Boolean(ctx.tavilyApiKey);

  return {
    name: 'web_search',
    description:
      `Search the web for information. Returns titles, URLs, and snippets. ` +
      `Backend: ${hasTavily ? 'Tavily (with AI summary)' : 'DuckDuckGo (basic)'}. ` +
      `Use web_fetch to read the full content of a specific URL from the results.`,
    label: 'Web Search',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      max_results: Type.Optional(
        Type.Number({ description: `Max results to return (default: ${DEFAULT_MAX_RESULTS}, max: 10)` }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const query = params.query as string;
      if (!query?.trim()) throw new Error('No search query provided');

      const maxResults = Math.min(Math.max(1, params.max_results ?? DEFAULT_MAX_RESULTS), 10);

      // Timeout
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) throw new Error('Aborted');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SEC * 1000);

      try {
        if (hasTavily) {
          const result = await searchTavily({
            apiKey: ctx.tavilyApiKey!,
            query,
            maxResults,
            signal: controller.signal,
          });
          return textResult(result);
        }

        const result = await searchDuckDuckGo({
          query,
          maxResults,
          signal: controller.signal,
        });
        return textResult(result);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
