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
import { createTextToSpeechTool } from './builtins/tts/text-to-speech';
// ask_user + confirm_action are served through the ToolModule registry.
// The AskUserContext type is still referenced by ToolFactoryContext.hitl below.
import type { AskUserContext } from './builtins/human/ask-user';
import { createMusicGenerateTool } from './builtins/music/music-generate';

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
  /** OpenAI API key for image_generate (DALL-E) */
  openaiApiKey?: string;
  /** Google/Gemini API key for image_generate */
  geminiApiKey?: string;
  /** Lazy OpenRouter key resolver (fetches from ApiKeyStore at tool call time) */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  /** Preferred image generation model */
  imageModel?: string;
  /** Start of the port range canva will auto-pick from */
  canvaPortRangeStart?: number;
  /** End of the port range canva will auto-pick from */
  canvaPortRangeEnd?: number;
  /** Preferred default TTS provider */
  ttsPreferredProvider?: 'openai' | 'elevenlabs' | 'google' | 'microsoft' | 'minimax';
  /** ElevenLabs API key for text_to_speech */
  elevenLabsApiKey?: string;
  /** ElevenLabs default voice id */
  elevenLabsDefaultVoice?: string;
  /** ElevenLabs default model id */
  elevenLabsDefaultModel?: string;
  /** OpenAI default TTS voice (e.g. "alloy") */
  openaiTtsVoice?: string;
  /** OpenAI TTS model (e.g. "gpt-4o-mini-tts") */
  openaiTtsModel?: string;
  /** Google Gemini TTS default voice (e.g. "Kore") */
  geminiTtsVoice?: string;
  /** Google Gemini TTS model override */
  geminiTtsModel?: string;
  /** Microsoft Azure Speech API key */
  microsoftTtsApiKey?: string;
  /** Microsoft Azure Speech region (e.g. "eastus") */
  microsoftTtsRegion?: string;
  /** Microsoft Azure default voice (e.g. "en-US-JennyNeural") */
  microsoftTtsVoice?: string;
  /** MiniMax API key */
  minimaxApiKey?: string;
  /** MiniMax group id */
  minimaxGroupId?: string;
  /** MiniMax default voice id */
  minimaxDefaultVoice?: string;
  /** MiniMax default model (e.g. "speech-02-hd") */
  minimaxDefaultModel?: string;
  /** Preferred default music generation provider */
  musicPreferredProvider?: 'google' | 'minimax';
  /** Google Gemini/Lyria default model override for music_generate (e.g. "lyria-002") */
  geminiMusicModel?: string;
  /** MiniMax music model (e.g. "music-01") */
  minimaxMusicModel?: string;
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

    // exec/bash + fs tools (read_file, write_file, edit_file, list_directory,
    // apply_patch) are served through the ToolModule registry above.

    // Music generation — needs the workspace for writing audio files.
    // Reuses the Gemini API key (Google Lyria) and the MiniMax API key from TTS.
    if (name === 'music_generate' && factoryContext?.cwd) {
      tools.push(createMusicGenerateTool({
        cwd: factoryContext.cwd,
        preferredProvider: factoryContext.musicPreferredProvider,
        geminiApiKey: factoryContext.geminiApiKey,
        geminiDefaultModel: factoryContext.geminiMusicModel,
        minimaxApiKey: factoryContext.minimaxApiKey,
        minimaxGroupId: factoryContext.minimaxGroupId,
        minimaxDefaultModel: factoryContext.minimaxMusicModel,
      }));
      continue;
    }

    // Text-to-speech — needs the workspace for writing audio files
    if (name === 'text_to_speech' && factoryContext?.cwd) {
      tools.push(createTextToSpeechTool({
        cwd: factoryContext.cwd,
        preferredProvider: factoryContext.ttsPreferredProvider,
        openaiApiKey: factoryContext.openaiApiKey,
        openaiDefaultVoice: factoryContext.openaiTtsVoice,
        openaiDefaultModel: factoryContext.openaiTtsModel,
        elevenLabsApiKey: factoryContext.elevenLabsApiKey,
        elevenLabsDefaultVoice: factoryContext.elevenLabsDefaultVoice,
        elevenLabsDefaultModel: factoryContext.elevenLabsDefaultModel,
        geminiApiKey: factoryContext.geminiApiKey,
        geminiDefaultVoice: factoryContext.geminiTtsVoice,
        geminiDefaultModel: factoryContext.geminiTtsModel,
        microsoftApiKey: factoryContext.microsoftTtsApiKey,
        microsoftRegion: factoryContext.microsoftTtsRegion,
        microsoftDefaultVoice: factoryContext.microsoftTtsVoice,
        minimaxApiKey: factoryContext.minimaxApiKey,
        minimaxGroupId: factoryContext.minimaxGroupId,
        minimaxDefaultVoice: factoryContext.minimaxDefaultVoice,
        minimaxDefaultModel: factoryContext.minimaxDefaultModel,
      }));
      continue;
    }

    // canva, image_generate, code_execution, web_search, web_fetch served
    // above via registry. image (analyze), show_image, ask_user,
    // confirm_action also via registry.

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
