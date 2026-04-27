// --- Shared type aliases (duplicated from src/types/ to keep shared/ self-contained) ---

export type MemoryBackend = 'builtin' | 'external' | 'cloud';
export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal' | 'custom';
export type ToolGroup = 'runtime' | 'fs' | 'web' | 'coding' | 'media' | 'communication' | 'human';
export type CompactionStrategy = 'summary' | 'sliding-window' | 'trim-oldest';

export type SystemPromptMode = 'auto' | 'append' | 'manual';

export interface SystemPromptSection {
  key: string;
  label: string;
  content: string;
  tokenEstimate: number;
}

export interface ResolvedSystemPrompt {
  mode: SystemPromptMode;
  sections: SystemPromptSection[];
  assembled: string;
  userInstructions: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  content: string;
  injectAs: 'system-prompt' | 'user-context';
}

export interface PluginHookBinding {
  hookName: string;
  handler: string;       // module path (relative to storage or absolute)
  priority?: number;     // default: 100
  critical?: boolean;    // default: false
}

export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  hooks?: PluginHookBinding[];
  enabled: boolean;
}

export type ModelInputModality = 'text' | 'image';

export interface ModelCostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelTopProviderInfo {
  contextLength?: number;
  maxCompletionTokens?: number;
  isModerated?: boolean;
}

export interface ModelCapabilityOverrides {
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  description?: string;
  modelName?: string;
}

export interface DiscoveredModelMetadata {
  id: string;
  provider: string;
  name?: string;
  description?: string;
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  raw?: unknown;
}

// --- Agent Config interfaces ---

export interface ResolvedCronConfig {
  cronNodeId: string;
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}

export interface ResolvedProviderConfig {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string; // raw override from node; '' means server fills plugin.defaultBaseUrl
}

export interface AgentConfig {
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];

  provider: ResolvedProviderConfig;
  modelId: string;
  thinkingLevel: string;
  systemPrompt: ResolvedSystemPrompt;
  modelCapabilities: ModelCapabilityOverrides;

  memory: ResolvedMemoryConfig | null;
  tools: ResolvedToolsConfig | null;
  contextEngine: ResolvedContextEngineConfig | null;
  connectors: ResolvedConnectorConfig[];
  agentComm: ResolvedAgentCommConfig[];
  storage: ResolvedStorageConfig | null;
  vectorDatabases: ResolvedVectorDatabaseConfig[];
  crons: ResolvedCronConfig[];
  mcps: ResolvedMcpConfig[];

  /** Working directory for shell commands (exec tool). Independent of storage path. */
  workspacePath: string | null;
  /** When true, exec workdir is constrained to stay within workspacePath. Defaults to false. */
  sandboxWorkdir?: boolean;
  /** xAI API key for code_execution tool */
  xaiApiKey?: string;
  /** xAI model for code_execution (defaults to grok-4-1-fast) */
  xaiModel?: string;
  /** Tavily API key for web_search. No key = DuckDuckGo fallback. */
  tavilyApiKey?: string;
  /** OpenAI API key for image_generate (DALL-E). */
  openaiApiKey?: string;
  /** Google/Gemini API key for image_generate. */
  geminiApiKey?: string;
  /** Preferred image generation model, e.g. "openai/gpt-image-1". */
  imageModel?: string;
  /** Lower bound (inclusive) of the port range canva will auto-pick from. */
  canvaPortRangeStart?: number;
  /** Upper bound (inclusive) of the port range canva will auto-pick from. */
  canvaPortRangeEnd?: number;

  /** Path for the persistent browser profile. Absolute or relative to workspace. Empty = <cwd>/.browser-profile. */
  browserUserDataDir?: string;
  /** When true Chromium runs without a visible window. Default true. */
  browserHeadless?: boolean;
  browserViewportWidth?: number;
  browserViewportHeight?: number;
  /** Per-action timeout used for navigation, clicks, fills, and other Playwright ops. */
  browserTimeoutMs?: number;
  /** Attach a screenshot to every state-changing browser action so the user can watch progress. */
  browserAutoScreenshot?: boolean;
  /** Inline screenshot format. Default "jpeg" for bandwidth. */
  browserScreenshotFormat?: 'jpeg' | 'png';
  /** JPEG quality 1-100. Ignored for PNG. Default 60. */
  browserScreenshotQuality?: number;
  /** Apply puppeteer-extra-plugin-stealth on launch. Default true. */
  browserStealth?: boolean;
  /** BCP-47 locale (e.g. en-US). Empty = en-US. */
  browserLocale?: string;
  /** IANA timezone (e.g. America/New_York). Empty = host system timezone. */
  browserTimezone?: string;
  /** Override the outbound User-Agent string. Empty = Playwright/stealth default. */
  browserUserAgent?: string;
  /**
   * Chrome DevTools Protocol endpoint (e.g. `http://127.0.0.1:9222`). When
   * set, the browser tool attaches to the user's already-running Chrome
   * via `connectOverCDP` and drives an isolated context inside it. Empty =
   * launch our own Chromium via persistent context. Invalid or unreachable
   * endpoints fall back to the persistent-context launch path.
   */
  browserCdpEndpoint?: string;

  /** Preferred default TTS provider. */
  ttsPreferredProvider?:
    | 'openai'
    | 'elevenlabs'
    | 'google'
    | 'microsoft'
    | 'minimax'
    | 'openrouter';
  /** ElevenLabs API key for text_to_speech. */
  elevenLabsApiKey?: string;
  elevenLabsDefaultVoice?: string;
  elevenLabsDefaultModel?: string;
  /** Override default OpenAI TTS voice/model (OpenAI API key is reused from image config). */
  openaiTtsVoice?: string;
  openaiTtsModel?: string;
  /** Override default Google Gemini TTS voice/model (Gemini API key is reused from image config). */
  geminiTtsVoice?: string;
  geminiTtsModel?: string;
  /** Microsoft Azure Speech configuration. */
  microsoftTtsApiKey?: string;
  microsoftTtsRegion?: string;
  microsoftTtsVoice?: string;
  /** MiniMax TTS configuration. */
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  minimaxDefaultVoice?: string;
  minimaxDefaultModel?: string;
  /** Override default OpenRouter TTS voice/model (OpenRouter key resolves lazily from ApiKeyStore). */
  openrouterTtsVoice?: string;
  openrouterTtsModel?: string;

  /** Preferred default music generation provider. */
  musicPreferredProvider?: 'google' | 'minimax';
  /** Google Lyria music model override (Gemini API key is reused from image config). */
  geminiMusicModel?: string;
  /** MiniMax music model override (MiniMax API key is reused from TTS config). */
  minimaxMusicModel?: string;

  exportedAt: number;
  sourceGraphId: string;
  runTimeoutMs: number;
  showReasoning?: boolean;
  verbose?: boolean;
}

export interface ResolvedMemoryConfig {
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
  compactionThreshold: number;
  compactionStrategy: string;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
  searchMode: string;
  externalEndpoint: string;
  externalApiKey: string;
}

export interface ResolvedToolsConfig {
  profile: ToolProfile;
  resolvedTools: string[];
  enabledGroups: ToolGroup[];
  skills: SkillDefinition[];
  plugins: PluginDefinition[];
  subAgentSpawning: boolean;
  maxSubAgents: number;
}

export interface ResolvedContextEngineConfig {
  tokenBudget: number;
  reservedForResponse: number;
  compactionStrategy: CompactionStrategy;
  /**
   * Model id used to produce summaries when `compactionStrategy` is
   * `summary`. Empty string means "inherit the agent's model".
   */
  summaryModelId?: string;
  compactionTrigger: string;
  compactionThreshold: number;
  /**
   * Target token count after compaction. Optional -- when omitted the
   * runtime falls back to `tokenBudget - reservedForResponse`.
   */
  postCompactionTokenTarget?: number;
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
}

export interface ResolvedConnectorConfig {
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

export interface ResolvedAgentCommConfig {
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
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

export interface ResolvedVectorDatabaseConfig {
  label: string;
  provider: string;
  collectionName: string;
  connectionString: string;
}

export type McpTransport = 'stdio' | 'http' | 'sse';

/** Resolved MCP server entry. Keyed by `mcpNodeId` so the server can emit
 *  `mcp:status` events that the UI can correlate back to a node. */
export interface ResolvedMcpConfig {
  mcpNodeId: string;
  label: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  toolPrefix: string;
  allowedTools: string[];
  autoConnect: boolean;
}
