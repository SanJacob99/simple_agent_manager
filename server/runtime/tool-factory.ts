import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';
import type {
  ProviderPluginDefinition,
  WebFetchToolContext,
  WebSearchToolContext,
} from '../../shared/plugin-sdk';
import { adaptAgentTools } from './tool-adapter';
import { findToolNameConflicts } from './tool-name-policy';
import { logError } from '../logger';

// Re-export resolveToolNames from shared (used by agent-runtime.ts)
export { resolveToolNames } from '../../shared/resolve-tool-names';

// --- All known tool names (including unimplemented) ---

export const ALL_TOOL_NAMES = [
  'bash',
  'code_interpreter',
  'read_file',
  'write_file',
  'list_directory',
  'web_search',
  'web_fetch',
  'calculator',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
  ...SESSION_TOOL_NAMES,
];

// Tool names that have a real implementation (not stubs).
// Only these are registered with the model.
export const IMPLEMENTED_TOOL_NAMES = new Set<string>([
  'calculator',
  'web_fetch',
  // Memory tools are built separately by MemoryEngine
  'memory_search',
  'memory_get',
  'memory_save',
  // Session tools are built separately by session-tools.ts
  ...SESSION_TOOL_NAMES,
]);

// --- Tool implementations (server-side stubs/real) ---

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function createCalculatorTool(): AgentTool<TSchema> {
  return {
    name: 'calculator',
    description: 'Evaluate a mathematical expression safely.',
    label: 'Calculator',
    parameters: Type.Object({
      expression: Type.String({ description: 'Math expression to evaluate' }),
    }),
    execute: async (_id, params: any) => {
      try {
        const expr = params.expression as string;

        // SECURITY: Prevent Remote Code Execution (RCE)
        // Validate expression contains only mathematical characters
        if (!/^[0-9+\-/*%().\s]+$/.test(expr)) {
          return textResult('Error: Invalid characters in expression. Only numbers and basic math operators are allowed.');
        }

        // Simple safe math eval using Function constructor with no scope
        const result = new Function(`"use strict"; return (${expr})`)();
        return textResult(String(result));
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : 'Invalid expression'}`);
      }
    },
  };
}

/**
 * Convert HTML to readable plain text. Strips tags, decodes common entities,
 * removes non-visible elements (script, style, head), and collapses whitespace.
 */
function htmlToText(html: string): string {
  let text = html;
  // Remove script, style, head, and noscript blocks entirely
  text = text.replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Convert block-level elements to newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|header|footer|nav|main)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/td>/gi, '\t');
  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  // Collapse whitespace: multiple spaces/tabs to single space, multiple newlines to double
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true;
  // Fallback: sniff the first 200 chars for a doctype or html tag
  const head = body.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function createWebFetchTool(): AgentTool<TSchema> {
  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns plain text; HTML pages are automatically converted to readable text.',
    label: 'Web Fetch',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
      method: Type.Optional(Type.String({ description: 'HTTP method (default: GET)' })),
    }),
    execute: async (_id, params: any, signal) => {
      try {
        // SECURITY: Prevent Server-Side Request Forgery (SSRF)
        const parsedUrl = new URL(params.url);

        // Enforce valid protocols
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return textResult('Error: Invalid URL protocol. Only http and https are allowed.');
        }

        // Block internal and reserved IP addresses/hostnames
        const hostname = parsedUrl.hostname.toLowerCase();
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '0.0.0.0' ||
          hostname === '::1' ||
          hostname === '169.254.169.254' ||
          hostname.endsWith('.internal') ||
          hostname.endsWith('.local')
        ) {
          return textResult('Error: Access to internal or restricted hosts is not permitted.');
        }

        const resp = await fetch(params.url, {
          method: params.method || 'GET',
          signal,
        });
        const raw = await resp.text();
        const contentType = resp.headers.get('content-type');
        const body = isHtmlResponse(contentType, raw) ? htmlToText(raw) : raw;
        const truncated = body.length > 10000 ? body.slice(0, 10000) + '\n...(truncated)' : body;
        return textResult(`Status: ${resp.status}\n\n${truncated}`);
      } catch (e) {
        return textResult(`Fetch error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createStubTool(name: string, description: string): AgentTool<TSchema> {
  return {
    name,
    description,
    label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    parameters: Type.Object({
      input: Type.Optional(Type.String({ description: 'Input parameter' })),
    }),
    execute: async () => {
      throw new Error(`Tool "${name}" is not yet implemented. Do not retry this tool — use an alternative approach.`);
    },
  };
}

// Only real (implemented) tools are registered with the model.
// Stub tools are NOT included — the model should never see a tool it can't use.
// TODO: Uncomment as each tool gets a real implementation:
//   bash: () => createTool('bash', 'Execute shell commands'),
//   code_interpreter: () => createTool('code_interpreter', 'Execute code in a sandboxed environment'),
//   read_file: () => createTool('read_file', 'Read a file from the filesystem'),
//   write_file: () => createTool('write_file', 'Write content to a file'),
//   list_directory: () => createTool('list_directory', 'List files in a directory'),
//   web_search: () => createTool('web_search', 'Search the web for information'),
//   send_message: () => createTool('send_message', 'Send a message to another agent or user'),
//   image_generation: () => createTool('image_generation', 'Generate an image from a text prompt'),
//   text_to_speech: () => createTool('text_to_speech', 'Convert text to speech'),
const TOOL_CREATORS: Record<string, () => AgentTool<TSchema>> = {
  calculator: createCalculatorTool,
  web_fetch: createWebFetchTool,
};

const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

interface ProviderWebToolContext {
  plugin: ProviderPluginDefinition;
  apiKey: string;
  baseUrl: string;
}

/**
 * Create AgentTool instances from a list of tool names.
 * Additional tools (e.g. memory tools) can be appended.
 */
export function createAgentTools(
  names: string[],
  extraTools: AgentTool<TSchema>[] = [],
  providerWebContext?: ProviderWebToolContext,
): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  for (const name of names) {
    // Skip memory and session tools - provided separately
    if (['memory_search', 'memory_get', 'memory_save'].includes(name)) continue;
    if (SESSION_TOOL_NAME_SET.has(name)) continue;

    if (name === 'web_search' && providerWebContext?.plugin.webSearch) {
      const ctx: WebSearchToolContext = {
        apiKey: providerWebContext.apiKey,
        baseUrl: providerWebContext.baseUrl,
      };
      tools.push(providerWebContext.plugin.webSearch.createTool(ctx));
      continue;
    }

    if (name === 'web_fetch' && providerWebContext?.plugin.webFetch) {
      const ctx: WebFetchToolContext = {
        apiKey: providerWebContext.apiKey,
        baseUrl: providerWebContext.baseUrl,
      };
      tools.push(providerWebContext.plugin.webFetch.createTool(ctx));
      continue;
    }

    const creator = TOOL_CREATORS[name];
    if (creator) {
      tools.push(creator());
    }
  }

  const combined = [...tools, ...extraTools];

  const conflicts = findToolNameConflicts(combined.map((t) => t.name));
  if (conflicts.length > 0) {
    logError(
      'tools',
      `tool name conflicts detected after resolution: ${conflicts.join(', ')}`,
    );
  }

  return adaptAgentTools(combined);
}
