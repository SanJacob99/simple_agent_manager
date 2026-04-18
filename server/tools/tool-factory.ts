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
import { createImageAnalyzeTool } from './builtins/image/image-analyze';
import { createImageGenerateTool } from './builtins/image/image-generate';
import { createShowImageTool } from './builtins/image/show-image';
import { createWebSearchTool } from './builtins/web/web-search';
import { createCanvaTool } from './builtins/canva/canva';
import { createTextToSpeechTool } from './builtins/tts/text-to-speech';
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

    // Canva (HTML/CSS/JS visualizations) — needs the agent workspace for file output
    if (name === 'canva' && factoryContext?.cwd) {
      tools.push(createCanvaTool({
        cwd: factoryContext.cwd,
        sandboxWorkdir: factoryContext.sandboxWorkdir,
        portRangeStart: factoryContext.canvaPortRangeStart,
        portRangeEnd: factoryContext.canvaPortRangeEnd,
      }));
      continue;
    }

    // Image tools
    if (name === 'image' && factoryContext?.cwd) {
      tools.push(createImageAnalyzeTool({ cwd: factoryContext.cwd }));
      continue;
    }
    if (name === 'show_image' && factoryContext?.cwd) {
      tools.push(createShowImageTool({ cwd: factoryContext.cwd }));
      continue;
    }
    if (name === 'image_generate' && factoryContext?.cwd) {
      tools.push(createImageGenerateTool({
        cwd: factoryContext.cwd,
        openaiApiKey: factoryContext.openaiApiKey,
        geminiApiKey: factoryContext.geminiApiKey,
        getOpenrouterApiKey: factoryContext.getOpenrouterApiKey,
        preferredModel: factoryContext.imageModel,
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
