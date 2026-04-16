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
import { createExecTool } from './builtins/exec/exec';
import { createCodeExecutionTool } from './builtins/code-execution/code-execution';
import { createReadFileTool } from './builtins/fs/read-file';
import { createWriteFileTool } from './builtins/fs/write-file';
import { createEditFileTool } from './builtins/fs/edit-file';
import { createListDirectoryTool } from './builtins/fs/list-directory';
import { createApplyPatchTool } from './builtins/fs/apply-patch';
import { createWebSearchTool } from './builtins/web/web-search';

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

// Re-export for backward compatibility
export { IMPLEMENTED_TOOL_NAMES } from '../../shared/resolve-tool-names';

// Only real (implemented) tools are registered with the model.
// Stub tools are NOT included — the model should never see a tool it can't use.
// TODO: Uncomment as each tool gets a real implementation:
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
  /** Tavily API key for web_search. When absent, falls back to DuckDuckGo. */
  tavilyApiKey?: string;
  /** Model ID — used to apply provider-specific schema cleaning (e.g. Gemini) */
  modelId?: string;
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
    // Skip session tools — provided separately by session-tools.ts
    if (SESSION_TOOL_NAME_SET.has(name)) continue;

    // Context-dependent tools
    if ((name === 'exec' || name === 'bash') && factoryContext?.cwd) {
      tools.push(createExecTool({
        cwd: factoryContext.cwd,
        sandboxWorkdir: factoryContext.sandboxWorkdir,
      }));
      continue;
    }

    // File I/O tools — share the same context as exec
    if ((name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'list_directory' || name === 'apply_patch') && factoryContext?.cwd) {
      const fsCtx = { cwd: factoryContext.cwd, sandboxWorkdir: factoryContext.sandboxWorkdir };
      if (name === 'read_file') tools.push(createReadFileTool(fsCtx));
      else if (name === 'write_file') tools.push(createWriteFileTool(fsCtx));
      else if (name === 'edit_file') tools.push(createEditFileTool(fsCtx));
      else if (name === 'list_directory') tools.push(createListDirectoryTool(fsCtx));
      else if (name === 'apply_patch') tools.push(createApplyPatchTool(fsCtx));
      continue;
    }

    if (name === 'code_execution' && factoryContext?.xaiApiKey) {
      tools.push(createCodeExecutionTool({
        apiKey: factoryContext.xaiApiKey,
        model: factoryContext.xaiModel,
      }));
      continue;
    }

    if (name === 'web_search') {
      // Provider plugin takes priority if available
      if (providerWebContext?.plugin.webSearch) {
        const ctx: WebSearchToolContext = {
          apiKey: providerWebContext.apiKey,
          baseUrl: providerWebContext.baseUrl,
        };
        tools.push(providerWebContext.plugin.webSearch.createTool(ctx));
      } else {
        // Built-in: Tavily (if key set) or DuckDuckGo fallback
        tools.push(createWebSearchTool({
          tavilyApiKey: factoryContext?.tavilyApiKey,
        }));
      }
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

  return adaptAgentTools(combined, factoryContext?.modelId);
}
