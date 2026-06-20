import type { Node } from '@xyflow/react';
import type { ModelCapabilityOverrides } from './model-metadata';
import type { SystemPromptMode } from '../../shared/agent-config';
import type { SubAgentOverridableField } from '../../shared/sub-agent-types';
import type { AgentCoordinationConfig } from '../../shared/coordination-types';

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
  | 'mcp'
  | 'subAgent'
  | 'guardrails'
  | 'observability';

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
  coordination?: AgentCoordinationConfig;
  /** Working directory for the agent. Empty = server process.cwd() */
  workingDirectory: string;
}

// --- Memory Node (OpenClaw-inspired) ---
//
// Two-tier model that mirrors OpenClaw:
//   - Long-term: a single `MEMORY.md` of durable facts (preferences, decisions,
//     standing instructions). Never auto-compacted.
//   - Short-term: `memory/YYYY-MM-DD.md` daily logs. Auto-loaded for recent
//     days; older days can be compacted into a summary or rolled forward.
// Persistence is delegated to the connected Storage node's memory directory;
// the engine is a no-op when no Storage node is wired.

export type MemorySearchMode = 'keyword' | 'hybrid';
export type MemoryCompactionStrategy = 'summary' | 'sliding-window';

export interface MemoryNodeData {
  [key: string]: unknown;
  type: 'memory';
  label: string;
  /** Inject `MEMORY.md` into the system prompt at session start. */
  autoLoadLongTerm: boolean;
  /** Max bytes of `MEMORY.md` to inject. 0 = no cap (whole file). */
  longTermMaxBytes: number;
  /** How many recent daily-log files to inject at session start (today counts as 1). */
  autoLoadShortTermDays: number;
  /** Periodically compact daily logs older than `compactionAfterDays`. */
  compactionEnabled: boolean;
  /** Daily logs older than this many days become candidates for compaction. */
  compactionAfterDays: number;
  /** Strategy used when compacting an old daily log. */
  compactionStrategy: MemoryCompactionStrategy;
  /** `keyword` = case-insensitive substring across all files. `hybrid` = keyword + vector (when wired). */
  searchMode: MemorySearchMode;
  /** Expose `memory_search` to the agent. */
  exposeMemorySearch: boolean;
  /** Expose `memory_get` (read whole file or line range) to the agent. */
  exposeMemoryGet: boolean;
  /** Expose `memory_save` to the agent. Takes a `scope` of long_term | short_term. */
  exposeMemorySave: boolean;
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
  /** When true Chromium runs without a visible window. Turn off for user handoff. */
  headless: boolean;
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
  /** Apply puppeteer-extra-plugin-stealth on launch to mask common automation signals. */
  stealth: boolean;
  /** BCP-47 locale. Empty = en-US. */
  locale: string;
  /** IANA timezone. Empty = host system timezone. */
  timezone: string;
  /** Override the outbound User-Agent string. Empty = Playwright/stealth default. */
  userAgent: string;
  /** CDP endpoint (e.g. http://127.0.0.1:9222). Empty = launch our own Chromium. */
  cdpEndpoint: string;
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

export type CompactionStrategy = 'summary' | 'sliding-window' | 'trim-oldest';

export interface ContextEngineNodeData {
  [key: string]: unknown;
  type: 'contextEngine';
  label: string;
  tokenBudget: number;
  reservedForResponse: number;
  compactionStrategy: CompactionStrategy;
  /**
   * Model used to produce the summary when `compactionStrategy` is
   * `summary`. Empty string means "inherit the agent's model".
   */
  summaryModelId?: string;
  compactionTrigger: 'auto' | 'manual' | 'threshold';
  compactionThreshold: number;
  /**
   * Target number of tokens the assembled context should land at after
   * compaction runs. Acts as a post-compaction ceiling -- the runtime
   * trims or summarizes until the message total is at or below this
   * value. Must be <= (tokenBudget - reservedForResponse).
   */
  postCompactionTokenTarget: number;
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
}

// --- Agent Communication Node ---

export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
  // Loop controls
  maxTurns: number;
  maxDepth: number;
  tokenBudget: number;
  rateLimitPerMinute: number;
  // Safety controls
  messageSizeCap: number;
  direction: 'bidirectional' | 'outbound' | 'inbound';
}

// --- Connectors Node ---

export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  /** Catalog ID, e.g. 'github'. Empty string means "not yet selected". */
  connectorId: string;
  /** Per-instance overrides for variables declared by the catalog entry.
   *  Keys are catalog-defined; values are strings (env var names, etc.). */
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

export type VectorStoreProvider =
  | 'sqlite-vec'
  | 'pinecone'
  | 'chromadb'
  | 'qdrant'
  | 'weaviate';

export type EmbeddingProvider = 'openrouter' | 'ollama';

export interface VectorEmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  baseUrl?: string;
  dimensions?: number;
}

export interface VectorDatabaseNodeData {
  [key: string]: unknown;
  type: 'vectorDatabase';
  label: string;
  provider: VectorStoreProvider;
  collectionName: string;
  connectionString: string;
  storagePath: string;
  embedding: VectorEmbeddingConfig;
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

// --- Guardrails Node ---

/**
 * Action taken when an input or output trips a guardrail rule.
 * - `block`: refuse the message; the runtime aborts the run with a structured
 *   `guardrail_blocked` error. Mirrors OpenAI AgentKit / n8n "stop on violation".
 * - `warn`: emit a `guardrail:violation` event but allow the message through.
 *   Useful for telemetry-only mode while tuning patterns.
 */
export type GuardrailAction = 'block' | 'warn';

export interface GuardrailsNodeData {
  [key: string]: unknown;
  type: 'guardrails';
  label: string;
  /** Master toggle. When false, the guardrail is wired but not enforced. */
  enabled: boolean;
  /** Apply rules to user messages before they reach the model. */
  checkInput: boolean;
  /** Apply rules to the assistant's reply after each turn. */
  checkOutput: boolean;
  /** Maximum length of a user message in characters. 0 disables this rule. */
  maxInputChars: number;
  /**
   * Case-insensitive substrings that, if present in the input or output,
   * trigger the configured action. Stored as strings because the graph must
   * remain JSON-serializable.
   */
  blockedTerms: string[];
  /**
   * Built-in PII categories enforced via well-tested regexes (email,
   * US Social Security Number, generic credit-card-shaped numbers).
   * Listed by id so the UI can render checkboxes without re-parsing.
   */
  piiCategories: GuardrailPiiCategory[];
  /** Behavior when a rule matches. */
  action: GuardrailAction;
  /**
   * Optional message shown to the user when the guardrail blocks an
   * interaction. Empty falls back to a generic notice.
   */
  blockMessage: string;
}

export type GuardrailPiiCategory = 'email' | 'ssn' | 'credit_card';

// --- Observability Node ---
//
// Configuration surface for run-level tracing, token/cost accounting, and
// latency telemetry. Mirrors the OpenTelemetry GenAI semantic conventions and
// common agent-observability backends (OTLP collectors, Langfuse). Treated as
// an extension surface: the graph resolves it into `AgentConfig.observability`,
// and the run coordinator is expected to honor it when emitting trace spans.

/**
 * Where trace spans are shipped.
 * - `none`: tracing wired but no export (spans are dropped). Useful for keeping
 *   the node configured while temporarily silencing telemetry.
 * - `console`: spans are logged to the server console. Zero-dependency default
 *   for local debugging.
 * - `otlp`: OpenTelemetry Protocol over HTTP to a collector `endpoint`.
 * - `langfuse`: Langfuse ingestion endpoint (uses `headers` for the key pair).
 */
export type TraceExporter = 'none' | 'console' | 'otlp' | 'langfuse';

export interface ObservabilityNodeData {
  [key: string]: unknown;
  type: 'observability';
  label: string;
  /** Master toggle. When false the node is wired but emits no spans. */
  enabled: boolean;
  /** Destination for emitted spans. */
  exporter: TraceExporter;
  /** OTLP/Langfuse endpoint URL. Empty = exporter default or env var. */
  endpoint: string;
  /** Extra HTTP headers for the exporter (e.g. `Authorization: Bearer ...`). */
  headers: Record<string, string>;
  /** `service.name` resource attribute attached to every span. */
  serviceName: string;
  /** Fraction of runs sampled for tracing, 0..1 (1 = trace every run). */
  sampleRate: number;
  /** Record the rendered prompt on LLM spans. */
  capturePrompts: boolean;
  /** Record the model completion text on LLM spans. */
  captureCompletions: boolean;
  /** Record tool-call arguments and results as span events. */
  captureToolIO: boolean;
  /** Strip emails/SSNs/credit-card numbers from captured text before export. */
  redactPii: boolean;
  /** Track token usage and estimated cost per run as span attributes. */
  trackCost: boolean;
  /** Emit a `latency.warn` span event when a turn exceeds this many ms. 0 = off. */
  latencyWarnMs: number;
}

// --- Sub-Agent Node ---

export interface SubAgentNodeData {
  [key: string]: unknown;
  type: 'subAgent';
  name: string;
  description: string;
  systemPrompt: string;
  modelIdMode: 'inherit' | 'custom';
  modelId: string;
  thinkingLevelMode: 'inherit' | 'custom';
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ModelCapabilityOverrides;
  overridableFields: SubAgentOverridableField[];
  workingDirectoryMode: 'derived' | 'custom';
  workingDirectory: string;
  recursiveSubAgentsEnabled: boolean;
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
  | MCPNodeData
  | SubAgentNodeData
  | GuardrailsNodeData
  | ObservabilityNodeData;

export type AppNode = Node<FlowNodeData>;
