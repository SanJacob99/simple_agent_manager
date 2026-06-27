// --- Shared type aliases (duplicated from src/types/ to keep shared/ self-contained) ---

import type { SubAgentOverridableField } from './sub-agent-types';
import type { AgentCoordinationConfig } from './coordination-types';

export type { SubAgentOverridableField } from './sub-agent-types';

export type MemorySearchMode = 'keyword' | 'hybrid';
export type MemoryCompactionStrategy = 'summary' | 'sliding-window';
export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal' | 'custom';
export type ToolGroup =
  | 'runtime'
  | 'fs'
  | 'web'
  | 'coding'
  | 'media'
  | 'communication'
  | 'human';
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

// --- Guardrails ---

export type GuardrailAction = 'block' | 'warn';
export type GuardrailPiiCategory = 'email' | 'ssn' | 'credit_card';

/**
 * Resolved guardrail rule set. Multiple guardrail nodes can be attached to a
 * single agent; the runtime evaluates them in order and the first match wins
 * for the `block` action. Storing each node as its own resolved entry keeps
 * the per-node `label` available for the violation event payload, which is
 * what the UI renders to explain *why* a turn was blocked.
 */
export interface ResolvedGuardrailConfig {
  guardrailNodeId: string;
  label: string;
  enabled: boolean;
  checkInput: boolean;
  checkOutput: boolean;
  maxInputChars: number;
  blockedTerms: string[];
  piiCategories: GuardrailPiiCategory[];
  action: GuardrailAction;
  blockMessage: string;
}

// --- Telemetry / Observability ---

/**
 * Where assembled telemetry spans are sent.
 * - `none`: spans are built in-memory but never exported (useful while wiring).
 * - `console`: pretty-print each completed run span to the server log.
 * - `file`: append newline-delimited JSON spans to `filePath`.
 * - `otlp`: POST OTLP/HTTP JSON to an OpenTelemetry collector at `otlpEndpoint`.
 */
export type TelemetryExporter = 'none' | 'console' | 'file' | 'otlp';

/**
 * Resolved observability configuration. A single telemetry node attaches to an
 * agent and instruments its runs: token usage, cost estimates, turn latency,
 * and tool-call spans. Mirrors the resolved-config shape used by guardrails so
 * the runtime can treat peripheral instrumentation uniformly. Multiple nodes
 * resolve to multiple entries; the runtime fans each completed span out to
 * every enabled exporter.
 */
export interface ResolvedTelemetryConfig {
  telemetryNodeId: string;
  label: string;
  enabled: boolean;
  /** Record prompt/response token counts per turn. */
  captureTokens: boolean;
  /** Derive a USD cost estimate from token counts and the model price table. */
  captureCost: boolean;
  /** Record wall-clock latency per turn and per tool call. */
  captureLatency: boolean;
  /** Emit a child span for every tool invocation (name, duration, error). */
  captureToolCalls: boolean;
  exporter: TelemetryExporter;
  /** OTLP/HTTP collector endpoint, e.g. `http://localhost:4318/v1/traces`. */
  otlpEndpoint: string;
  /** Extra headers for the OTLP request (e.g. `Authorization`). */
  otlpHeaders: Record<string, string>;
  /** Destination for the `file` exporter. Relative paths resolve to the workspace. */
  filePath: string;
  /** `service.name` resource attribute attached to every span. */
  serviceName: string;
  /** Fraction of runs to record, 0..1. 1 records every run. */
  sampleRate: number;
  /** Strip message/prompt content from spans, keeping only counts and metadata. */
  redactContent: boolean;
}

// --- Structured Output ---

/**
 * `strict`: validate required fields and reject undeclared properties when the
 * schema sets `additionalProperties: false`. `loose`: validate only the
 * keywords present, ignoring extra properties.
 */
export type StructuredOutputMode = 'strict' | 'loose';

/**
 * Repair policy when the final response fails schema validation.
 * - `reprompt`: feed validation errors back to the model, up to
 *   `maxRepairAttempts` retries.
 * - `passthrough`: keep the invalid response, flagged as unvalidated.
 * - `error`: fail the run.
 */
export type StructuredOutputOnError = 'reprompt' | 'passthrough' | 'error';

/**
 * Resolved structured-output configuration. At most one structured-output node
 * constrains an agent: its `schema` (raw JSON Schema text) is the contract the
 * final response must satisfy. The runtime validates the response in its
 * finalize step and applies the repair policy. `schema` is kept as raw text so
 * `AgentConfig` stays serializable and the schema round-trips through
 * import/export unchanged; the engine parses it lazily.
 */
export interface ResolvedStructuredOutputConfig {
  structuredOutputNodeId: string;
  label: string;
  enabled: boolean;
  /** Raw JSON Schema text. Parsed lazily by the structured-output engine. */
  schema: string;
  /** Name advertised to the model / used as the schema-as-tool name. */
  schemaName: string;
  mode: StructuredOutputMode;
  onValidationError: StructuredOutputOnError;
  /** Max re-prompt attempts when `onValidationError` is `reprompt`. */
  maxRepairAttempts: number;
  /** Append the schema and an instruction to the system prompt. */
  includeSchemaInPrompt: boolean;
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

export interface ResolvedSubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;                              // resolved (custom value or inherited from parent)
  thinkingLevel: string;                        // resolved
  modelCapabilities: ModelCapabilityOverrides;
  overridableFields: SubAgentOverridableField[];
  workingDirectory: string;                     // resolved (derived or custom)
  recursiveSubAgentsEnabled: boolean;

  provider: ResolvedProviderConfig;             // dedicated wins; else parent's
  tools: ResolvedToolsConfig;                   // dedicated; required
  skills: SkillDefinition[];                    // parent ∪ dedicated; dedicated wins by id
  mcps: ResolvedMcpConfig[];                    // parent ∪ dedicated; dedicated wins by mcpNodeId
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
  agentComm: ResolvedAgentCommConfig[];
  storage: ResolvedStorageConfig | null;
  vectorDatabases: ResolvedVectorDatabaseConfig[];
  crons: ResolvedCronConfig[];
  mcps: ResolvedMcpConfig[];
  subAgents: ResolvedSubAgentConfig[];
  coordination?: AgentCoordinationConfig;
  /**
   * Optional input/output guardrail rule sets. When omitted or empty, the
   * runtime skips all guardrail checks. Optional — not required —
   * so existing AgentConfig fixtures and serialized graphs remain
   * compatible without a backfill.
   */
  guardrails?: ResolvedGuardrailConfig[];
  /**
   * Optional observability instrumentation. When omitted or empty, the runtime
   * emits no telemetry. Optional so existing AgentConfig fixtures and serialized
   * graphs remain compatible without a backfill.
   */
  telemetry?: ResolvedTelemetryConfig[];
  /**
   * Optional structured-output contract. At most one structured-output node
   * constrains the agent's final response to a JSON Schema. Omitted when no
   * structured-output node is connected, so existing AgentConfig fixtures and
   * serialized graphs remain compatible without a backfill.
   */
  outputSchema?: ResolvedStructuredOutputConfig;

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
  /** Inject `MEMORY.md` into the system prompt at session start. */
  autoLoadLongTerm: boolean;
  /** Max bytes of `MEMORY.md` to inject. 0 = no cap. */
  longTermMaxBytes: number;
  /** How many recent daily-log files to inject at session start. */
  autoLoadShortTermDays: number;
  /** Periodically compact daily logs older than `compactionAfterDays`. */
  compactionEnabled: boolean;
  compactionAfterDays: number;
  compactionStrategy: MemoryCompactionStrategy;
  searchMode: MemorySearchMode;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
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

export interface ResolvedAgentCommConfig {
  commNodeId: string;
  label: string;
  targetAgentNodeId: string | null;
  targetAgentName: string | null;
  protocol: 'direct' | 'broadcast';
  maxTurns: number;
  maxDepth: number;
  tokenBudget: number;
  rateLimitPerMinute: number;
  messageSizeCap: number;
  direction: 'bidirectional' | 'outbound' | 'inbound';
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

export type VectorStoreProvider =
  | 'sqlite-vec'
  | 'pinecone'
  | 'chromadb'
  | 'qdrant'
  | 'weaviate';

export type EmbeddingProvider = 'openrouter' | 'ollama';

export interface ResolvedVectorEmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  baseUrl?: string;
  dimensions?: number;
}

export interface ResolvedVectorDatabaseConfig {
  label: string;
  provider: VectorStoreProvider;
  collectionName: string;
  connectionString: string;
  storagePath: string;
  embedding: ResolvedVectorEmbeddingConfig;
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
