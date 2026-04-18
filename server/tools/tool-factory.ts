import type { TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import { adaptAgentTools } from './tool-adapter';
import { findToolNameConflicts } from './tool-name-policy';
import { logError } from '../logger';
import type { AgentConfig } from '../../shared/agent-config';
import { REGISTERED_TOOL_NAMES, buildToolFromModule } from './tool-registry';
import type { RuntimeHints } from './tool-module';
import { createCalculatorTool } from './builtins/calculator/calculator';
// ask_user + confirm_action are served through the ToolModule registry.
// The AskUserContext type is still referenced by ToolFactoryContext.hitl below.
import type { AskUserContext } from './builtins/human/ask-user';

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
  'canva',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
  'music_generate',
  ...SESSION_TOOL_NAMES,
];

// Re-export for backward compatibility
export { IMPLEMENTED_TOOL_NAMES } from '../../shared/resolve-tool-names';

// Only real (implemented) tools are registered with the model.
// Stub tools are NOT included — the model should never see a tool it can't use.
// TODO: Uncomment as each tool gets a real implementation:
//   send_message: () => createTool('send_message', 'Send a message to another agent or user'),
//   text_to_speech: () => createTool('text_to_speech', 'Convert text to speech'),
const TOOL_CREATORS: Record<string, () => AgentTool<TSchema>> = {
  // `calculator` is also served by the ToolModule registry; keeping it in
  // this legacy map as a safety-net while the migration is in progress.
  calculator: createCalculatorTool,
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
  /** Lazy OpenRouter key resolver (fetches from ApiKeyStore at tool call time) */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  /** Model ID — used to apply provider-specific schema cleaning (e.g. Gemini) */
  modelId?: string;
  /**
   * Context needed by the ask_user (HITL) tool. When absent, the tool is
   * skipped during registration even if its name appears in `names`.
   */
  hitl?: AskUserContext;
  /**
   * Full `AgentConfig`. Passed through to `ToolModule.resolveContext` so
   * migrated tools can read their own config fields. Legacy tools don't
   * need this — they consume scalar fields (`weatherApiKey`, etc.) above.
   */
  agentConfig?: AgentConfig;
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

  // Shared RuntimeHints for ToolModule-based tools. Built once per call —
  // modules that need config fields read them through `agentConfig` in
  // their own `resolveContext`.
  const runtime: RuntimeHints = {
    cwd: factoryContext?.cwd ?? process.cwd(),
    sandboxWorkdir: factoryContext?.sandboxWorkdir,
    modelId: factoryContext?.modelId,
    hitl: factoryContext?.hitl,
    getOpenrouterApiKey: factoryContext?.getOpenrouterApiKey,
    providerWeb: providerWebContext,
  };
  // Fall-back AgentConfig for modules that were pointed at the registry
  // from code paths that didn't have a real config. Safe because migrated
  // modules either ignore `config` entirely (calculator) or read a field
  // that will be undefined in the empty object (tools with required auth
  // will return null from `create`).
  const agentConfig = factoryContext?.agentConfig ?? ({} as AgentConfig);

  for (const name of names) {
    // Skip session tools — provided separately by session-tools.ts
    if (SESSION_TOOL_NAME_SET.has(name)) continue;

    // ToolModule registry takes precedence. Migrated tools are served
    // exclusively out of the registry — their legacy switch branches
    // below are dead weight while the migration is in progress and will
    // be deleted once every tool has a module.
    if (REGISTERED_TOOL_NAMES.has(name)) {
      const tool = buildToolFromModule(name, agentConfig, runtime);
      if (tool) tools.push(tool);
      continue;
    }

    // Everything else (exec/bash, fs tools, web_search, web_fetch, canva,
    // code_execution, image_analyze, image_generate, show_image, ask_user,
    // confirm_action, text_to_speech, music_generate) is served through the
    // ToolModule registry above. The only thing left in TOOL_CREATORS is a
    // safety-net fallback for calculator during the transition.

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
