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
  | 'telemetry'
  | 'structuredOutput'
  | 'budget'
  | 'evals'
  | 'reflection';

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

// --- Telemetry / Observability Node ---

/**
 * Where the runtime ships assembled spans. See `TelemetryExporter` in
 * `shared/agent-config.ts` for the resolved-config mirror of this surface.
 */
export type TelemetryExporter = 'none' | 'console' | 'file' | 'otlp';

export interface TelemetryNodeData {
  [key: string]: unknown;
  type: 'telemetry';
  label: string;
  /** Master toggle. When false, the node is wired but no spans are emitted. */
  enabled: boolean;
  /** Record prompt/response token counts per turn. */
  captureTokens: boolean;
  /** Derive a USD cost estimate from token counts and the model price table. */
  captureCost: boolean;
  /** Record wall-clock latency per turn and per tool call. */
  captureLatency: boolean;
  /** Emit a child span for every tool invocation (name, duration, error). */
  captureToolCalls: boolean;
  /** Destination for completed spans. */
  exporter: TelemetryExporter;
  /** OTLP/HTTP collector endpoint, e.g. `http://localhost:4318/v1/traces`. */
  otlpEndpoint: string;
  /** Extra headers for the OTLP request (e.g. `Authorization: Bearer ...`). */
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

// --- Structured Output Node ---

/**
 * What the runtime does when the agent's final reply fails JSON-Schema
 * validation.
 * - `repair`: re-prompt the model up to `maxRepairAttempts` times with the
 *   validation errors, asking it to return conforming JSON. Mirrors the
 *   "auto-fixing" output parsers in LangChain / Instructor / BAML.
 * - `warn`: emit a `structured_output:invalid` event but pass the reply
 *   through unchanged. Useful while tuning a schema.
 * - `block`: finalize the run with a `structured_output_invalid` error,
 *   the way a strict tool-call schema would reject a malformed argument.
 */
export type StructuredOutputOnError = 'repair' | 'warn' | 'block';

export interface StructuredOutputNodeData {
  [key: string]: unknown;
  type: 'structuredOutput';
  label: string;
  /** Master toggle. When false, the node is wired but the reply is unconstrained. */
  enabled: boolean;
  /** Schema identifier surfaced to the model and used in OpenAI `response_format`. */
  schemaName: string;
  /**
   * The JSON Schema the final reply must satisfy, stored as a JSON *string* so
   * the graph stays serializable. Parsed and validated by the runtime; an
   * unparseable schema disables enforcement and surfaces a warning.
   */
  schema: string;
  /**
   * `true` forwards the schema to providers that support native structured
   * outputs (`response_format: json_schema`, strict tool calls). `false`
   * relies on prompt guidance plus post-hoc validation only.
   */
  strict: boolean;
  /** Behaviour when the reply does not conform to the schema. */
  onValidationError: StructuredOutputOnError;
  /** Maximum re-prompt rounds when `onValidationError` is `repair`. */
  maxRepairAttempts: number;
  /** Append the schema to the system prompt so models without native support still comply. */
  injectSchemaIntoPrompt: boolean;
}

// --- Budget / Rate-Governance Node ---

/**
 * What the runtime does when a budget ceiling is reached.
 * - `warn`: emit a `budget:exceeded` event and keep going. Telemetry-only.
 * - `downshift`: switch the run to `downshiftModelId` (a cheaper model) for the
 *   remainder of the run, then warn. No-op if no downshift model is set.
 * - `block`: stop the run with a `budget_exceeded` error before the next turn
 *   or tool call.
 */
export type BudgetDegradePolicy = 'warn' | 'downshift' | 'block';

export interface BudgetNodeData {
  [key: string]: unknown;
  type: 'budget';
  label: string;
  /** Master toggle. When false, the node is wired but no ceilings are enforced. */
  enabled: boolean;
  /** Max estimated USD spend per run. 0 disables this ceiling. */
  maxUsdPerRun: number;
  /** Max estimated USD spend per rolling 24h window. 0 disables this ceiling. */
  maxUsdPerDay: number;
  /** Max total tokens (prompt + completion) per run. 0 disables this ceiling. */
  maxTokensPerRun: number;
  /** Max tool invocations per run. 0 disables this ceiling. */
  maxToolCallsPerRun: number;
  /** Max runs started per rolling minute. 0 disables this ceiling. */
  maxRunsPerMinute: number;
  /** Behaviour when any ceiling is reached. */
  degradePolicy: BudgetDegradePolicy;
  /** Model used when `degradePolicy` is `downshift`. Empty falls back to `warn`. */
  downshiftModelId: string;
  /** Message returned to the user when a `block` policy stops a run. Empty = generic notice. */
  blockMessage: string;
}

// --- Evaluations Node ---

/**
 * How a single eval case is scored.
 * - `exact_match`: the trimmed reply must equal `expected` exactly.
 * - `contains`: the reply must contain `expected` as a substring (case-insensitive).
 * - `regex`: `expected` is a JS regular expression the reply must match.
 * - `json_schema`: `expected` is a JSON Schema the reply (parsed as JSON) must satisfy.
 * - `llm_judge`: a judge model scores the reply against `expected` using `judgePrompt`.
 */
export type EvalGraderType =
  | 'exact_match'
  | 'contains'
  | 'regex'
  | 'json_schema'
  | 'llm_judge';

/** A single input → expected pair plus the grader used to score the reply. */
export interface EvalCase {
  /** Stable identifier so per-case scores can be tracked across runs. */
  id: string;
  /** The prompt sent to the agent for this case. */
  input: string;
  /**
   * Reference value. Its meaning depends on `grader`: the expected text
   * (`exact_match`/`contains`), a regex source (`regex`), a JSON Schema string
   * (`json_schema`), or judge rubric/reference (`llm_judge`).
   */
  expected: string;
  /** Grader for this case. Falls back to the node's `defaultGrader` when omitted. */
  grader?: EvalGraderType;
  /** Relative weight in the suite score. Defaults to 1. */
  weight: number;
}

export interface EvalsNodeData {
  [key: string]: unknown;
  type: 'evals';
  label: string;
  /** Master toggle. When false the suite is wired but never executed. */
  enabled: boolean;
  /** The dataset of input → expected cases. */
  cases: EvalCase[];
  /** Grader used for cases that do not specify their own. */
  defaultGrader: EvalGraderType;
  /** Weighted suite score (0..1) at or above which the suite is considered passing. */
  passThreshold: number;
  /** Model used for `llm_judge` cases. Empty falls back to the agent's model. */
  judgeModelId: string;
  /** Rubric appended to the judge prompt for `llm_judge` cases. */
  judgePrompt: string;
  /** Max cases executed concurrently by the runner. */
  maxConcurrency: number;
  /**
   * When true, the runner compares the suite score against the previously
   * recorded best and flags a regression if it drops. Surfaces eval-driven
   * regression gating in CI / `sam eval`.
   */
  failOnRegression: boolean;
}

// --- Reflection / Self-Critique Node ---

/**
 * What the reflection loop returns when no attempt reaches `scoreThreshold`
 * within `maxRevisions` passes.
 * - `accept_best`: return the highest-scoring attempt seen.
 * - `accept_last`: return the most recent (final) revision.
 * - `warn`: return the highest-scoring attempt but flag that the threshold was
 *   never met (the runtime emits a `reflection:below_threshold` event).
 */
export type ReflectionExhaustionPolicy = 'accept_best' | 'accept_last' | 'warn';

/**
 * A reflection node wraps the finalize step in a Reflexion-style
 * draft → critique → revise loop: after the agent produces a candidate reply, a
 * critic pass scores it against `rubric` and, below `scoreThreshold`, feeds the
 * critique back for up to `maxRevisions` revisions. Pairs with the Evals node —
 * the same rubric can grade both.
 */
export interface ReflectionNodeData {
  [key: string]: unknown;
  type: 'reflection';
  label: string;
  /** Master toggle. When false the node is wired but the finalize step is unchanged. */
  enabled: boolean;
  /** Criteria the critic scores the reply against. Empty means "general quality". */
  rubric: string;
  /** Max revise passes after the initial draft. 0 makes the loop critique-only. */
  maxRevisions: number;
  /** Accept once an attempt's score (0..1) reaches this. 1 forces every revision. */
  scoreThreshold: number;
  /** Model used for the critic/revise passes. Empty falls back to the agent's model. */
  criticModelId: string;
  /** What to return when `maxRevisions` is exhausted without meeting the threshold. */
  onMaxRevisions: ReflectionExhaustionPolicy;
  /** When true, the critique text is kept in the transcript instead of being dropped. */
  includeCritiqueInTranscript: boolean;
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
  | TelemetryNodeData
  | StructuredOutputNodeData
  | BudgetNodeData
  | EvalsNodeData
  | ReflectionNodeData;

export type AppNode = Node<FlowNodeData>;
