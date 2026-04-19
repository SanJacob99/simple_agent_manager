import type { TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';
import { adaptAgentTools } from './tool-adapter';
import { findToolNameConflicts } from './tool-name-policy';
import { logError } from '../logger';
import type { AgentConfig } from '../../shared/agent-config';
import {
  REGISTERED_TOOL_NAMES,
  buildToolFromModule,
  resolveToolName,
} from './tool-registry';
import type { ProviderWebContext, RuntimeHints } from './tool-module';
import { createCalculatorTool } from './builtins/calculator/calculator';
// `AskUserContext` is referenced by `ToolFactoryContext.hitl` below — the
// HITL tools themselves are served through the ToolModule registry.
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

// Stub creators for tools that have neither been migrated to a
// `ToolModule` nor wired to a real implementation yet. Today this is
// just `calculator`, which has a real implementation but no module —
// every other tool is served exclusively from the registry.
const TOOL_CREATORS: Record<string, () => AgentTool<TSchema>> = {
  calculator: createCalculatorTool,
};

const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

export interface ToolFactoryContext {
  /** Agent workspace directory — used as cwd for workspace-aware tools. */
  cwd?: string;
  /** When true, exec workdir is constrained to stay within cwd. Defaults to false. */
  sandboxWorkdir?: boolean;
  /** Lazy OpenRouter key resolver (fetches from ApiKeyStore at tool call time). */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  /** Model id — used to apply provider-specific schema cleaning (e.g. Gemini). */
  modelId?: string;
  /**
   * Context needed by the ask_user (HITL) tool. When absent, the tool is
   * skipped during registration even if its name appears in `names`.
   */
  hitl?: AskUserContext;
  /**
   * Full `AgentConfig`. Passed through to `ToolModule.resolveContext` so
   * migrated tools can read their own config fields directly instead of
   * going through scalar passthrough properties.
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
  providerWebContext?: ProviderWebContext,
  factoryContext?: ToolFactoryContext,
): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  // Shared RuntimeHints for ToolModule-based tools. Built once per call —
  // modules read their own config fields through `agentConfig`.
  const runtime: RuntimeHints = {
    cwd: factoryContext?.cwd ?? process.cwd(),
    sandboxWorkdir: factoryContext?.sandboxWorkdir,
    modelId: factoryContext?.modelId,
    hitl: factoryContext?.hitl,
    getOpenrouterApiKey: factoryContext?.getOpenrouterApiKey,
    providerWeb: providerWebContext,
  };
  // Fall-back AgentConfig for code paths that don't have a real config.
  // Modules that need required fields will return null from `create`.
  const agentConfig = factoryContext?.agentConfig ?? ({} as AgentConfig);

  // Dedupe by canonical name so aliases don't produce two copies of the
  // same `AgentTool`. Example: the UI can enable both `bash` and `exec`
  // (they're the same module under the hood) — without this guard, the
  // model would see two function declarations named `exec`, and strict
  // providers (Gemini) reject the request with "Duplicate function
  // declaration".
  const builtCanonical = new Set<string>();
  for (const name of names) {
    // Skip session tools — provided separately by session-tools.ts
    if (SESSION_TOOL_NAME_SET.has(name)) continue;

    // Registry takes precedence. Migrated tools are served exclusively
    // out of the registry — the only fallback below is for stub tools
    // that haven't been migrated yet.
    if (REGISTERED_TOOL_NAMES.has(name)) {
      const canonical = resolveToolName(name);
      if (builtCanonical.has(canonical)) continue;
      builtCanonical.add(canonical);
      const tool = buildToolFromModule(name, agentConfig, runtime);
      if (tool) tools.push(tool);
      continue;
    }

    if (builtCanonical.has(name)) continue;
    const creator = TOOL_CREATORS[name];
    if (creator) {
      builtCanonical.add(name);
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
