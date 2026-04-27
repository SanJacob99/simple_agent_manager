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
  BrowserToolSettings,
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

export const browserToolConfigSchema: ObjectSchema<BrowserToolSettings> = {
  type: 'object',
  properties: {
    userDataDir: {
      type: 'string',
      title: 'Profile directory',
      placeholder: '<cwd>/.browser-profile',
      description:
        'Where Chromium stores cookies, localStorage, and login state. Relative paths resolve against the workspace.',
    },
    headless: {
      type: 'boolean',
      title: 'Headless',
      checkboxLabel: 'Run without opening a browser window',
      description:
        'Off by default so users can take over protected steps (login, CAPTCHA, payment) in the live window; the tool automatically falls back to headless if the environment has no display. Turn this on to force headless even when a display is available.',
    },
    viewportWidth: {
      type: 'integer',
      title: 'Viewport width',
      minimum: 320,
      maximum: 3840,
    },
    viewportHeight: {
      type: 'integer',
      title: 'Viewport height',
      minimum: 240,
      maximum: 2160,
    },
    timeoutMs: {
      type: 'integer',
      title: 'Default timeout (ms)',
      minimum: 1000,
      maximum: 300000,
      description: 'Applies to navigation, clicks, and fills.',
    },
    autoScreenshot: {
      type: 'boolean',
      title: 'Stream screenshots',
      checkboxLabel: 'Attach a screenshot to every state-changing action',
      description:
        'When on, the user sees a screenshot after each navigate/act/click/type. These images also enter the agent\'s context, so vision-capable models can use them too.',
    },
    screenshotFormat: {
      type: 'string',
      title: 'Format',
      enum: [
        { value: 'jpeg', label: 'JPEG (smaller, lossy)' },
        { value: 'png', label: 'PNG (lossless)' },
      ],
    },
    screenshotQuality: {
      type: 'integer',
      title: 'JPEG quality',
      minimum: 1,
      maximum: 100,
      description: 'Ignored for PNG. Lower = smaller payload. 60 is a good default.',
    },
    stealth: {
      type: 'boolean',
      title: 'Stealth',
      checkboxLabel: 'Apply the stealth plugin (hide common automation signals)',
      description:
        'Masks navigator.webdriver, Chromium plugin arrays, WebGL vendor, and the "HeadlessChrome" UA. Dramatically reduces entry-level bot-protection false positives. Does NOT defeat TLS/JA3 fingerprinting, IP reputation, or behavioral analysis. The underlying library has been unmaintained since 2023.',
    },
    locale: {
      type: 'string',
      title: 'Locale',
      placeholder: 'en-US',
      description: 'BCP-47 locale sent to the browser context and Accept-Language header.',
    },
    timezone: {
      type: 'string',
      title: 'Timezone',
      placeholder: 'Host system timezone',
      description: 'IANA timezone name (e.g. America/New_York). Leave empty to use the host system.',
    },
    userAgent: {
      type: 'string',
      title: 'User-Agent override',
      placeholder: 'Leave empty to use Playwright/stealth default',
      description:
        'Override only if a specific site needs a specific UA. Stealth already rewrites the bundled Chromium UA to look non-headless.',
    },
    cdpEndpoint: {
      type: 'string',
      title: 'Attach to your Chrome (CDP)',
      placeholder: 'http://127.0.0.1:9222',
      description:
        'When set, the tool attaches to a Chrome you launched with --remote-debugging-port=9222 instead of spawning its own Chromium. The agent drives a fresh isolated context inside your real browser — best defense against TLS/JA3 bot protection, and it inherits your cookies/extensions. Launch Chrome with: (Win) "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222  (mac) /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222  (Linux) google-chrome --remote-debugging-port=9222. Unreachable endpoints silently fall back to the normal launch path.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use browser...',
      description: 'Injected into the system prompt to guide browser usage.',
    },
  },
  sections: [
    {
      title: 'Screenshot streaming',
      description:
        'Auto-attach screenshots so the user can watch the browser. Explicit `screenshot` calls are unaffected.',
      startAt: 'autoScreenshot',
    },
    {
      title: 'Anti-detection & emulation',
      description:
        'Shape the browser fingerprint so pages treat it like an ordinary user. Defaults are sensible; override only when a specific site needs it.',
      startAt: 'stealth',
    },
  ],
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
        { value: 'openrouter', label: 'OpenRouter' },
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
    openrouterVoice: {
      type: 'string',
      title: 'Voice',
      placeholder: 'alloy, echo, fable, onyx, nova, shimmer',
    },
    openrouterModel: {
      type: 'string',
      title: 'Model',
      placeholder: 'openai/gpt-4o-audio-preview',
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
    {
      title: 'OpenRouter',
      description:
        'Uses the OpenRouter key from the global API keys. Audio output is produced by an audio-capable chat model (e.g. gpt-4o-audio-preview).',
      startAt: 'openrouterVoice',
    },
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
