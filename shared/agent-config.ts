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

export type StructuredOutputOnError = 'repair' | 'warn' | 'block';

/**
 * Resolved structured-output constraint. At most one structured-output node
 * binds to an agent, so this resolves to a single optional value on
 * `AgentConfig` rather than a list (unlike guardrails/telemetry). The runtime
 * validates the agent's final reply against `schema` in the finalize step and
 * applies `onValidationError`.
 */
export interface ResolvedStructuredOutputConfig {
  structuredOutputNodeId: string;
  label: string;
  enabled: boolean;
  schemaName: string;
  /** Raw JSON Schema text exactly as authored on the node. */
  schema: string;
  strict: boolean;
  onValidationError: StructuredOutputOnError;
  maxRepairAttempts: number;
  injectSchemaIntoPrompt: boolean;
}

// --- Budget / Rate-Governance ---

export type BudgetDegradePolicy = 'warn' | 'downshift' | 'block';

/**
 * Resolved spend/rate envelope. Multiple budget nodes can attach to one agent
 * (e.g. a per-run token cap plus a per-day USD cap); the runtime enforces all
 * of them and the strictest reached ceiling wins. Mirrors the resolved-config
 * shape used by guardrails so the runtime treats cost safety and content
 * safety uniformly.
 */
export interface ResolvedBudgetConfig {
  budgetNodeId: string;
  label: string;
  enabled: boolean;
  maxUsdPerRun: number;
  maxUsdPerDay: number;
  maxTokensPerRun: number;
  maxToolCallsPerRun: number;
  maxRunsPerMinute: number;
  degradePolicy: BudgetDegradePolicy;
  downshiftModelId: string;
  blockMessage: string;
}

// --- Evaluations ---

export type EvalGraderType =
  | 'exact_match'
  | 'contains'
  | 'regex'
  | 'json_schema'
  | 'llm_judge';

export interface ResolvedEvalCase {
  id: string;
  input: string;
  expected: string;
  /** Resolved grader: the case's own grader, or the suite `defaultGrader`. */
  grader: EvalGraderType;
  weight: number;
}

/**
 * Resolved evaluation suite. Multiple eval nodes can attach to one agent (e.g. a
 * smoke suite plus a regression suite); each resolves to its own entry and the
 * `sam eval` runner executes them independently. The runner replays each case
 * through the resolved agent headlessly and scores the reply with the named
 * grader, mirroring eval-driven workflows from OpenAI Evals, Braintrust,
 * Promptfoo, and LangSmith datasets.
 */
export interface ResolvedEvalsConfig {
  evalsNodeId: string;
  label: string;
  enabled: boolean;
  cases: ResolvedEvalCase[];
  passThreshold: number;
  judgeModelId: string;
  judgePrompt: string;
  maxConcurrency: number;
  failOnRegression: boolean;
}

// --- Reflection / Self-critique ---

export type ReflectionExhaustionPolicy = 'use_best' | 'use_last' | 'warn';

/**
 * Resolved reflection loop. At most one reflection node binds to an agent — it
 * wraps the single finalize step — so this resolves to a single optional value
 * on `AgentConfig` rather than a list (like structured output). The runtime
 * critiques the agent's candidate reply against `rubric` and re-prompts for up
 * to `maxRevisions` revisions, mirroring Reflexion / Self-Refine loops.
 */
export interface ResolvedReflectionConfig {
  reflectionNodeId: string;
  label: string;
  enabled: boolean;
  rubric: string;
  scoreThreshold: number;
  maxRevisions: number;
  /** Model used for the critique pass. Empty falls back to the agent's model. */
  criticModelId: string;
  critiquePrompt: string;
  onExhaustion: ReflectionExhaustionPolicy;
  injectRubricIntoPrompt: boolean;
}

// --- Agent-to-Agent (A2A) interop ---

export type A2ARole = 'server' | 'client' | 'both';

/** Resolved remote A2A delegate. */
export interface ResolvedA2ARemoteAgent {
  id: string;
  name: string;
  cardUrl: string;
  authTokenEnv: string;
  enabled: boolean;
}

/**
 * Resolved A2A interop surface. At most one A2A node binds to an agent, so this
 * resolves to a single optional value on `AgentConfig` (like reflection /
 * structured output) rather than a list. Exposes this agent over the
 * Agent-to-Agent protocol (published agent card + inbound task endpoint) and/or
 * registers remote A2A agents as callable delegates.
 */
export interface ResolvedA2AConfig {
  a2aNodeId: string;
  label: string;
  enabled: boolean;
  role: A2ARole;
  /** Agent-card `name`. Empty falls back to the agent's own name at serve time. */
  agentName: string;
  agentDescription: string;
  agentVersion: string;
  serverPath: string;
  advertisedSkills: string[];
  streaming: boolean;
  pushNotifications: boolean;
  requireAuth: boolean;
  inboundTokenEnv: string;
  remotes: ResolvedA2ARemoteAgent[];
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
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
   * Optional structured-output constraint. When omitted or `null`, the agent's
   * reply is unconstrained. At most one structured-output node binds to an
   * agent. Optional so existing AgentConfig fixtures remain compatible.
   */
  outputSchema?: ResolvedStructuredOutputConfig | null;
  /**
   * Optional spend/rate envelopes. When omitted or empty, the runtime enforces
   * no cost or rate ceilings. Optional so existing AgentConfig fixtures and
   * serialized graphs remain compatible without a backfill.
   */
  budgets?: ResolvedBudgetConfig[];
  /**
   * Optional evaluation suites. When omitted or empty, the agent has no
   * attached evals. Not part of the live run path — consumed by the `sam eval`
   * runner and the Settings evals panel. Optional so existing AgentConfig
   * fixtures and serialized graphs remain compatible without a backfill.
   */
  evals?: ResolvedEvalsConfig[];
  /**
   * Optional reflection loop. When omitted or `null`, the runtime finalizes the
   * agent's reply without a critique/revise pass. At most one reflection node
   * binds to an agent. Optional so existing AgentConfig fixtures and serialized
   * graphs remain compatible without a backfill.
   */
  reflection?: ResolvedReflectionConfig | null;
  /**
   * Optional Agent-to-Agent (A2A) interop surface. When omitted or `null`, the
   * agent neither publishes an A2A server nor registers remote delegates. At
   * most one A2A node binds to an agent. Optional so existing AgentConfig
   * fixtures and serialized graphs remain compatible without a backfill.
   */
  a2a?: ResolvedA2AConfig | null;

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
