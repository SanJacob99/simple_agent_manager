import type { TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';
import type {
  ProviderPluginDefinition,
  WebFetchToolContext,
  WebSearchToolContext,
} from '../../shared/plugin-sdk';
import { adaptAgentTools } from './tool-adapter';
import { findToolNameConflicts } from './tool-name-policy';
import { logError } from '../logger';
import { createCalculatorTool } from './builtins/calculator/calculator';
import { createWebFetchTool } from './builtins/web/web-fetch';
import { createExecTool, type ExecToolContext } from './builtins/exec/exec';
import { createCodeExecutionTool } from './builtins/code-execution/code-execution';

// Re-export resolveToolNames from shared (used by agent-runtime.ts)
export { resolveToolNames } from '../../shared/resolve-tool-names';

// --- All known tool names (including unimplemented) ---

export const ALL_TOOL_NAMES = [
  'exec',
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
  'exec',
  'code_execution',
  'calculator',
  'web_fetch',
  // Memory tools are built separately by MemoryEngine
  'memory_search',
  'memory_get',
  'memory_save',
  // Session tools are built separately by session-tools.ts
  ...SESSION_TOOL_NAMES,
]);

// Only real (implemented) tools are registered with the model.
// Stub tools are NOT included — the model should never see a tool it can't use.
// TODO: Uncomment as each tool gets a real implementation:
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
  // exec requires runtime context (cwd) — handled in createAgentTools below
};

const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

interface ProviderWebToolContext {
  plugin: ProviderPluginDefinition;
  apiKey: string;
  baseUrl: string;
}

export interface ToolFactoryContext {
  /** Agent workspace directory — used as cwd for the exec tool */
  cwd?: string;
  /** When true, exec workdir is constrained to stay within cwd. Defaults to false. */
  sandboxWorkdir?: boolean;
  /** xAI API key for code_execution tool */
  xaiApiKey?: string;
  /** xAI model override for code_execution (defaults to grok-4-1-fast) */
  xaiModel?: string;
}

/**
 * Create AgentTool instances from a list of tool names.
 * Additional tools (e.g. memory tools) can be appended.
 */
export function createAgentTools(
  names: string[],
  extraTools: AgentTool<TSchema>[] = [],
  providerWebContext?: ProviderWebToolContext,
  factoryContext?: ToolFactoryContext,
): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  for (const name of names) {
    // Skip memory and session tools - provided separately
    if (['memory_search', 'memory_get', 'memory_save'].includes(name)) continue;
    if (SESSION_TOOL_NAME_SET.has(name)) continue;

    // Context-dependent tools
    if ((name === 'exec' || name === 'bash') && factoryContext?.cwd) {
      tools.push(createExecTool({
        cwd: factoryContext.cwd,
        sandboxWorkdir: factoryContext.sandboxWorkdir,
      }));
      continue;
    }

    if (name === 'code_execution' && factoryContext?.xaiApiKey) {
      tools.push(createCodeExecutionTool({
        apiKey: factoryContext.xaiApiKey,
        model: factoryContext.xaiModel,
      }));
      continue;
    }

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
