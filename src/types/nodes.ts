import type { Node } from '@xyflow/react';
import type { ModelCapabilityOverrides } from './model-metadata';
import type { SystemPromptMode } from '../../shared/agent-config';

export type NodeType =
  | 'agent'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'contextEngine'
  | 'agentComm'
  | 'connectors'
  | 'storage'
  | 'vectorDatabase'
  | 'cron'
  | 'provider'
  | 'mcp';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// --- Agent Node ---

export interface AgentNodeData {
  [key: string]: unknown;
  type: 'agent';
  name: string;
  nameConfirmed: boolean;
  systemPrompt: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  description: string;
  tags: string[];
  modelCapabilities: ModelCapabilityOverrides;
  systemPromptMode: SystemPromptMode;
  showReasoning: boolean;
  verbose: boolean;
  /** Working directory for the agent. Empty = server process.cwd() */
  workingDirectory: string;
}

// --- Memory Node (OpenClaw-inspired) ---

export type MemoryBackend = 'builtin' | 'external' | 'cloud';

export interface MemoryNodeData {
  [key: string]: unknown;
  type: 'memory';
  label: string;
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
  compactionStrategy: 'summary' | 'sliding-window' | 'hybrid';
  compactionThreshold: number;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
  searchMode: 'keyword' | 'semantic' | 'hybrid';
  externalEndpoint: string;
  externalApiKey: string;
}

// --- Tools Node (OpenClaw-inspired) ---

export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal' | 'custom';
export type ToolGroup = 'runtime' | 'fs' | 'web' | 'coding' | 'media' | 'communication' | 'human';

export interface SkillDefinition {
  id: string;
  name: string;
  content: string;
  injectAs: 'system-prompt' | 'user-context';
}

export interface PluginHookBinding {
  hookName: string;
  handler: string;
  priority?: number;
  critical?: boolean;
}

export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  hooks?: PluginHookBinding[];
  enabled: boolean;
}

export interface ExecToolSettings {
  /** Working directory for shell commands. Empty string = server process.cwd() */
  cwd: string;
  /** When true, workdir param is constrained to stay within cwd */
  sandboxWorkdir: boolean;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface CodeExecutionToolSettings {
  /** xAI API key (or env var name). Empty = reads XAI_API_KEY from environment */
  apiKey: string;
  /** xAI model override (defaults to grok-4-1-fast) */
  model: string;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface WebSearchToolSettings {
  /** Tavily API key. Empty = reads TAVILY_API_KEY from env. No key = DuckDuckGo fallback. */
  tavilyApiKey: string;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface ImageToolSettings {
  /** OpenAI API key for DALL-E. Empty = reads OPENAI_API_KEY from env. */
  openaiApiKey: string;
  /** Google/Gemini API key. Empty = reads GEMINI_API_KEY from env. */
  geminiApiKey: string;
  /** Preferred model, e.g. "openai/gpt-image-1" or "google/gemini-2.0-flash-exp" */
  preferredModel: string;
  /** Markdown guidance for image tools */
  skill: string;
}

export interface CanvaToolSettings {
  /** Start of the port range used when the agent doesn't request a specific port */
  portRangeStart: number;
  /** End of the port range (inclusive) */
  portRangeEnd: number;
  /** Markdown guidance for the canva tool */
  skill: string;
}

export interface BrowserToolSettings {
  /** Persistent profile path. Absolute or relative to workspace. Empty = <cwd>/.browser-profile. */
  userDataDir: string;
  viewportWidth: number;
  viewportHeight: number;
  /** Per-action timeout (navigation, clicks, fills) in milliseconds. */
  timeoutMs: number;
  /** Attach a screenshot to every state-changing action so the user can watch progress. */
  autoScreenshot: boolean;
  /** Format for inline screenshots. "jpeg" is cheaper; "png" is lossless. */
  screenshotFormat: 'jpeg' | 'png';
  /** JPEG quality 1-100. Ignored for PNG. */
  screenshotQuality: number;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export type TtsProviderId =
  | ''
  | 'openai'
  | 'elevenlabs'
  | 'google'
  | 'microsoft'
  | 'minimax'
  | 'openrouter';

export interface TextToSpeechToolSettings {
  /** Preferred default provider. Empty = first configured. */
  preferredProvider: TtsProviderId;
  /** ElevenLabs API key. Empty = reads ELEVENLABS_API_KEY from env. */
  elevenLabsApiKey: string;
  elevenLabsDefaultVoice: string;
  elevenLabsDefaultModel: string;
  /** Override OpenAI TTS voice/model. Uses ImageToolSettings.openaiApiKey. */
  openaiVoice: string;
  openaiModel: string;
  /** Google Gemini TTS voice/model. Uses ImageToolSettings.geminiApiKey. */
  geminiVoice: string;
  geminiModel: string;
  /** Microsoft Azure Speech */
  microsoftApiKey: string;
  microsoftRegion: string;
  microsoftDefaultVoice: string;
  /** MiniMax */
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxDefaultVoice: string;
  minimaxDefaultModel: string;
  /**
   * OpenRouter audio output. Uses the OpenRouter API key from the global
   * API key store; voice/model only override the defaults of whichever
   * audio-capable model is selected.
   */
  openrouterVoice: string;
  openrouterModel: string;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export type MusicProviderId = '' | 'google' | 'minimax';

export interface MusicGenerateToolSettings {
  /** Preferred default provider. Empty = first configured. */
  preferredProvider: MusicProviderId;
  /** Google Gemini/Lyria music model override. Uses ImageToolSettings.geminiApiKey. */
  geminiModel: string;
  /** MiniMax music model (e.g. "music-01"). Uses TextToSpeechToolSettings.minimaxApiKey and minimaxGroupId. */
  minimaxModel: string;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface ToolSettings {
  exec: ExecToolSettings;
  codeExecution: CodeExecutionToolSettings;
  webSearch: WebSearchToolSettings;
  image: ImageToolSettings;
  canva: CanvaToolSettings;
  browser: BrowserToolSettings;
  textToSpeech: TextToSpeechToolSettings;
  musicGenerate: MusicGenerateToolSettings;
}

export interface ToolsNodeData {
  [key: string]: unknown;
  type: 'tools';
  label: string;
  profile: ToolProfile;
  enabledTools: string[];
  enabledGroups: ToolGroup[];
  skills: SkillDefinition[];
  plugins: PluginDefinition[];
  subAgentSpawning: boolean;
  maxSubAgents: number;
  toolSettings: ToolSettings;
}

// --- Skills Node ---

export interface SkillsNodeData {
  [key: string]: unknown;
  type: 'skills';
  label: string;
  enabledSkills: string[];
}

// --- Context Engine Node (OpenClaw-inspired) ---

export type CompactionStrategy = 'summary' | 'sliding-window' | 'trim-oldest' | 'hybrid';

export interface ContextEngineNodeData {
  [key: string]: unknown;
  type: 'contextEngine';
  label: string;
  tokenBudget: number;
  reservedForResponse: number;
  ownsCompaction: boolean;
  compactionStrategy: CompactionStrategy;
  /**
   * Model used to produce the summary when `compactionStrategy` is
   * `summary` or `hybrid`. Empty string means "inherit the agent's model".
   */
  summaryModelId?: string;
  compactionTrigger: 'auto' | 'manual' | 'threshold';
  compactionThreshold: number;
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
}

// --- Agent Communication Node ---

export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

// --- Connectors Node ---

export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

// --- Storage Node ---

export type StorageBackend = 'filesystem';

export interface StorageNodeData {
  [key: string]: unknown;
  type: 'storage';
  label: string;
  backendType: StorageBackend;
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
  // Maintenance
  maintenanceMode: 'warn' | 'enforce';
  pruneAfterDays: number;
  maxEntries: number;
  rotateBytes: number;
  resetArchiveRetentionDays: number;
  maxDiskBytes: number;
  highWaterPercent: number;
  maintenanceIntervalMinutes: number;
}

// --- Vector Database Node ---

export interface VectorDatabaseNodeData {
  [key: string]: unknown;
  type: 'vectorDatabase';
  label: string;
  provider: 'pinecone' | 'chromadb' | 'qdrant' | 'weaviate';
  collectionName: string;
  connectionString: string;
}

// --- Cron Node ---

export interface CronNodeData {
  [key: string]: unknown;
  type: 'cron';
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}

// --- Provider Node ---

export interface ProviderNodeData {
  [key: string]: unknown;
  type: 'provider';
  label: string;
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}

// --- MCP Node ---

/**
 * Transport used to reach the MCP server.
 * - `stdio`: local subprocess launched from `command` + `args`
 * - `http`: remote JSON-RPC over HTTP
 * - `sse`: remote Server-Sent Events stream
 */
export type McpTransport = 'stdio' | 'http' | 'sse';

export type McpConnectionStatus =
  | 'unknown'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnected';

export interface MCPNodeData {
  [key: string]: unknown;
  type: 'mcp';
  label: string;
  transport: McpTransport;
  /** Local stdio: executable to spawn (e.g. `npx`). */
  command: string;
  /** Local stdio: arguments passed to the command. */
  args: string[];
  /** Local stdio: extra env vars for the child process. */
  env: Record<string, string>;
  /** Local stdio: working directory for the subprocess. Empty = inherit server cwd. */
  cwd: string;
  /** Remote http/sse: full URL of the MCP server endpoint. */
  url: string;
  /** Remote http/sse: extra HTTP headers (e.g. `Authorization: Bearer ...`). */
  headers: Record<string, string>;
  /** Prefix applied to every tool name from this server to avoid collisions. */
  toolPrefix: string;
  /** Optional whitelist of tools to expose. Empty = all tools from the server. */
  allowedTools: string[];
  /** Connect when the agent starts. When false, a tool call triggers lazy connect. */
  autoConnect: boolean;
}

// --- Union Types ---

export type FlowNodeData =
  | AgentNodeData
  | MemoryNodeData
  | ToolsNodeData
  | SkillsNodeData
  | ContextEngineNodeData
  | AgentCommNodeData
  | ConnectorsNodeData
  | StorageNodeData
  | VectorDatabaseNodeData
  | CronNodeData
  | ProviderNodeData
  | MCPNodeData;

export type AppNode = Node<FlowNodeData>;
