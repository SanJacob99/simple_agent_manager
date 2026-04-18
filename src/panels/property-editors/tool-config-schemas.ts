/**
 * Schema declarations for per-tool configuration UI.
 *
 * Each schema targets one slot on `ToolSettings` and feeds `SchemaForm` so
 * the old hand-written per-tool page in `ToolsProperties.tsx` can be
 * replaced by a declarative render. Kept client-side for now; the same
 * structure will consume server-authored schemas from
 * `ToolModule.config.schema` once that is wired through an API endpoint.
 */

import type { ObjectSchema } from './schema-form/types';
import type {
  CanvaToolSettings,
  CodeExecutionToolSettings,
  ExecToolSettings,
  ImageToolSettings,
  MusicGenerateToolSettings,
  TextToSpeechToolSettings,
  WebSearchToolSettings,
} from '../../types/nodes';

export const execToolConfigSchema: ObjectSchema<ExecToolSettings> = {
  type: 'object',
  properties: {
    cwd: {
      type: 'string',
      title: 'Working directory override',
      placeholder: 'Inherited from agent node',
      description: "Leave empty to use the agent node's working directory.",
    },
    sandboxWorkdir: {
      type: 'boolean',
      title: 'Sandbox',
      checkboxLabel: 'Restrict workdir to cwd',
      description: 'When enabled, the agent cannot set workdir outside of the configured cwd.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use exec...',
      description: 'Injected into the system prompt to guide exec usage.',
    },
  },
};

export const codeExecutionToolConfigSchema: ObjectSchema<CodeExecutionToolSettings> = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      format: 'password',
      title: 'xAI API Key',
      placeholder: 'Empty = reads XAI_API_KEY from env',
    },
    model: {
      type: 'string',
      title: 'Model',
      placeholder: 'grok-4-1-fast (default)',
      description: 'Runs sandboxed Python on xAI. For calculations, statistics, data analysis.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use code_execution...',
      description: 'Injected into the system prompt to guide code_execution usage.',
    },
  },
};

export const webSearchToolConfigSchema: ObjectSchema<WebSearchToolSettings> = {
  type: 'object',
  properties: {
    tavilyApiKey: {
      type: 'string',
      format: 'password',
      title: 'Tavily API Key',
      placeholder: 'Empty = TAVILY_API_KEY env or DuckDuckGo fallback',
      description:
        'With a Tavily key: AI-summarized results (free tier: 500/month). Without: basic DuckDuckGo HTML scrape.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use web_search...',
      description: 'Injected into the system prompt to guide web_search usage.',
    },
  },
};

export const canvaToolConfigSchema: ObjectSchema<CanvaToolSettings> = {
  type: 'object',
  properties: {
    portRangeStart: {
      type: 'integer',
      title: 'Port range start',
      minimum: 1024,
      maximum: 65535,
    },
    portRangeEnd: {
      type: 'integer',
      title: 'Port range end',
      minimum: 1024,
      maximum: 65535,
      description: 'The agent auto-picks a free port in this range. It may also request a specific port.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use canva...',
      description: 'Injected into the system prompt to guide canva usage.',
    },
  },
};

/**
 * `image` schema covers the API keys and skill field. The preferred-model
 * picker stays hand-written in `ToolsProperties.tsx` because it switches
 * between an input and a catalog-filtered `<select>` depending on the
 * connected provider's plugin and whether the OpenRouter model catalog
 * has been synced — dynamics the schema cannot express cleanly.
 */
export const imageToolConfigSchema: ObjectSchema<ImageToolSettings> = {
  type: 'object',
  properties: {
    openaiApiKey: {
      type: 'string',
      format: 'password',
      title: 'OpenAI API Key',
      placeholder: 'Empty = reads OPENAI_API_KEY from env',
      description: 'For DALL-E / gpt-image-1. Supports edit mode with up to 5 reference images.',
    },
    geminiApiKey: {
      type: 'string',
      format: 'password',
      title: 'Google / Gemini API Key',
      placeholder: 'Empty = reads GEMINI_API_KEY from env',
      description: 'For Gemini image generation. Supports edit mode.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use image tools...',
      description: 'Injected into the system prompt to guide image tool usage.',
    },
  },
};

export const textToSpeechToolConfigSchema: ObjectSchema<TextToSpeechToolSettings> = {
  type: 'object',
  properties: {
    preferredProvider: {
      type: 'string',
      title: 'Preferred provider',
      enum: [
        { value: '', label: '(first configured)' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'elevenlabs', label: 'ElevenLabs' },
        { value: 'google', label: 'Google Gemini' },
        { value: 'microsoft', label: 'Microsoft Azure' },
        { value: 'minimax', label: 'MiniMax' },
      ],
    },
    elevenLabsApiKey: {
      type: 'string',
      format: 'password',
      title: 'API Key',
      placeholder: 'Empty = reads ELEVENLABS_API_KEY from env',
    },
    elevenLabsDefaultVoice: {
      type: 'string',
      title: 'Default voice ID',
      placeholder: '21m00Tcm4TlvDq8ikWAM (Rachel)',
    },
    elevenLabsDefaultModel: {
      type: 'string',
      title: 'Default model',
      placeholder: 'eleven_multilingual_v2',
    },
    openaiVoice: {
      type: 'string',
      title: 'Voice',
      placeholder: 'alloy, nova, shimmer, echo, fable, onyx',
    },
    openaiModel: {
      type: 'string',
      title: 'Model',
      placeholder: 'gpt-4o-mini-tts (default)',
    },
    geminiVoice: {
      type: 'string',
      title: 'Voice',
      placeholder: 'Kore, Puck, Charon, Fenrir, …',
    },
    geminiModel: {
      type: 'string',
      title: 'Model',
      placeholder: 'gemini-2.5-flash-preview-tts',
    },
    microsoftApiKey: {
      type: 'string',
      format: 'password',
      title: 'API Key',
      placeholder: 'Empty = reads AZURE_SPEECH_KEY from env',
    },
    microsoftRegion: {
      type: 'string',
      title: 'Region',
      placeholder: 'eastus',
    },
    microsoftDefaultVoice: {
      type: 'string',
      title: 'Default voice',
      placeholder: 'en-US-JennyNeural',
    },
    minimaxApiKey: {
      type: 'string',
      format: 'password',
      title: 'API Key',
      placeholder: 'Empty = reads MINIMAX_API_KEY from env',
    },
    minimaxGroupId: {
      type: 'string',
      title: 'Group ID',
      placeholder: 'Empty = reads MINIMAX_GROUP_ID from env',
    },
    minimaxDefaultVoice: {
      type: 'string',
      title: 'Default voice',
      placeholder: 'male-qn-qingse',
    },
    minimaxDefaultModel: {
      type: 'string',
      title: 'Default model',
      placeholder: 'speech-02-hd',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use text_to_speech...',
      description: 'Injected into the system prompt to guide TTS usage.',
    },
  },
  sections: [
    { title: 'ElevenLabs', startAt: 'elevenLabsApiKey' },
    {
      title: 'OpenAI',
      description: 'Reuses the OpenAI API key from the image settings.',
      startAt: 'openaiVoice',
    },
    {
      title: 'Google Gemini',
      description: 'Reuses the Gemini API key from the image settings.',
      startAt: 'geminiVoice',
    },
    { title: 'Microsoft Azure', startAt: 'microsoftApiKey' },
    { title: 'MiniMax', startAt: 'minimaxApiKey' },
  ],
};

export const musicGenerateToolConfigSchema: ObjectSchema<MusicGenerateToolSettings> = {
  type: 'object',
  properties: {
    preferredProvider: {
      type: 'string',
      title: 'Preferred provider',
      enum: [
        { value: '', label: '(first configured)' },
        { value: 'google', label: 'Google Lyria' },
        { value: 'minimax', label: 'MiniMax Music' },
      ],
    },
    geminiModel: {
      type: 'string',
      title: 'Model',
      placeholder: 'lyria-002 (default)',
    },
    minimaxModel: {
      type: 'string',
      title: 'Model',
      placeholder: 'music-01 (default)',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use music_generate...',
      description: 'Injected into the system prompt to guide music generation usage.',
    },
  },
  sections: [
    {
      title: 'Google Lyria',
      description: 'Reuses the Gemini API key from the image settings.',
      startAt: 'geminiModel',
    },
    {
      title: 'MiniMax Music',
      description: 'Reuses the MiniMax API key and group id from text_to_speech.',
      startAt: 'minimaxModel',
    },
  ],
};

/**
 * Sub-agent controls are on `ToolsNodeData` itself (not under
 * `toolSettings`), so this schema targets a narrow slice of that shape.
 * `maxSubAgents` is hidden via `fieldOverrides` when spawning is off.
 */
export interface SubAgentsFormValue {
  subAgentSpawning: boolean;
  maxSubAgents: number;
}

export const subAgentsToolConfigSchema: ObjectSchema<SubAgentsFormValue> = {
  type: 'object',
  properties: {
    subAgentSpawning: {
      type: 'boolean',
      title: 'Sub-Agent Spawning',
      checkboxLabel: 'Enable sub-agent spawning',
    },
    maxSubAgents: {
      type: 'integer',
      title: 'Max Sub-Agents',
      minimum: 1,
      maximum: 10,
    },
  },
};
