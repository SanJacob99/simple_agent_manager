import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentConfig } from '../../shared/agent-config';
import type { ImageAttachment } from '../../shared/protocol';
import type { DiscoveredModelMetadata } from '../../shared/agent-config';
import type { HookRegistry } from '../hooks/hook-registry';
import type { BeforeToolCallContext, AfterToolCallContext } from '../hooks/hook-types';
import { HOOK_NAMES } from '../hooks/hook-types';
import type { ProviderPluginRegistry } from '../providers/plugin-registry';
import { resolveProviderRuntimeAuth } from '../providers/provider-auth';
import { resolveProviderStreamFn } from '../providers/stream-resolver';
import { MemoryEngine } from './memory-engine';
import { ContextEngine } from './context-engine';
import { resolveToolNames, createAgentTools } from '../tools/tool-factory';
import { resolveRuntimeModel } from './model-resolver';
import { isToolErrorDetails } from '../tools/tool-adapter';
import { estimatePayloadBreakdown } from './payload-breakdown';
import { resolveOutboundSystemPrompt } from './resolve-system-prompt';
import type { ResolvedSystemPrompt } from '../../shared/agent-config';
import { log, logApiExchange } from '../logger';
import type { HitlRegistry } from '../hitl/hitl-registry';
import type { ServerEvent } from '../../shared/protocol';
import { DEFAULT_SAFETY_SETTINGS, type SafetySettings } from '../storage/settings-file-store';
import { wrappedStreamFn } from './stream-wrapper';

export type RuntimeEvent =
  | AgentEvent
  | { type: 'runtime_ready'; config: AgentConfig }
  | { type: 'runtime_error'; error: string }
  | { type: 'memory_compaction'; summary: string }
  | {
      type: 'context_usage_preview';
      /** Estimated tokens in the payload about to be dispatched. */
      estimatedTokens: number;
      contextWindow: number;
      breakdown: import('../../shared/context-usage').ContextUsageBreakdown;
    };

export type RuntimeEventListener = (event: RuntimeEvent) => void;


function summarizePayload(payload: any): string {
  const model: string = payload.model ?? 'unknown';
  const messages: any[] = payload.messages ?? [];
  const tools: any[] = payload.tools ?? [];
  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
  let lastUserText = '';
  if (lastUser) {
    const content = lastUser.content;
    if (typeof content === 'string') {
      lastUserText = content.length > 200 ? content.slice(0, 200) + '...' : content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find((b: any) => b.type === 'text');
      if (textBlock?.text) {
        const t: string = textBlock.text;
        lastUserText = t.length > 200 ? t.slice(0, 200) + '...' : t;
      }
    }
  }
  const reasoning = payload.reasoning !== undefined
    ? JSON.stringify(payload.reasoning)
    : '(absent)';
  const reasoningEffort = payload.reasoning_effort !== undefined
    ? String(payload.reasoning_effort)
    : '(absent)';
  const topLevelKeys = Object.keys(payload).join(',');
  return (
    `model=${model} | messages=${messages.length} | tools=${tools.length} | ` +
    `reasoning=${reasoning} | reasoning_effort=${reasoningEffort} | ` +
    `keys=[${topLevelKeys}] | last_user=${lastUserText}`
  );
}

function headersToRecord(
  headers: HeadersInit | Headers | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = redactSensitiveHeader(key, value);
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = redactSensitiveHeader(key, value);
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = redactSensitiveHeader(key, value);
    }
  }
  return out;
}

function redactSensitiveHeader(key: string, value: string): string {
  const lower = key.toLowerCase();
  if (lower === 'authorization' || lower === 'x-api-key' || lower.endsWith('-api-key')) {
    return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : '***';
  }
  return value;
}

/**
 * AgentRuntime wraps pi-agent-core Agent with memory, context engine, and tools.
 * Fully decoupled from React -- can run headless.
 */
export class AgentRuntime {
  private agent: Agent;
  private config: AgentConfig;
  private listeners = new Set<RuntimeEventListener>();
  private memoryEngine: MemoryEngine | null = null;
  private contextEngine: ContextEngine | null = null;
  private unsubscribeAgent: (() => void) | null = null;
  private hookRegistry: HookRegistry | null = null;
  private baseTools: AgentTool<TSchema>[] = [];
  private initialSystemPrompt: string = '';
  /**
   * The system prompt as pi-ai will send it, broken into sections for
   * UI display. Derived from `config.systemPrompt.sections` with
   * bundled-skills-root substitution applied, plus any runtime-added
   * sections (workspace fallback, HITL confirmation policy). Kept in
   * sync with `initialSystemPrompt`.
   */
  private resolvedSystemPrompt: ResolvedSystemPrompt = {
    mode: 'auto',
    sections: [],
    assembled: '',
    userInstructions: '',
  };
  private getApiKeyFn: (provider: string) => Promise<string | undefined> | string | undefined;
  private getDiscoveredModelFn: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined;

  /** Current session key — set by RunCoordinator before each prompt so HITL tools know their session. */
  private currentSessionKey: string = '';
  /** Broadcast function injected by AgentManager after the WS bridge is wired. */
  private broadcastFn: ((event: ServerEvent) => void) | null = null;

  /** Last API-level error message from a non-2xx response. Cleared on each `prompt()` call. */
  lastApiError: string | null = null;

  constructor(
    config: AgentConfig,
    getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
    getDiscoveredModel?: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined,
    hookRegistry?: HookRegistry,
    private readonly pluginRegistry?: ProviderPluginRegistry,
    private readonly hitlRegistry?: HitlRegistry,
    private readonly safetySettings: SafetySettings = DEFAULT_SAFETY_SETTINGS,
  ) {
    this.config = config;
    this.getApiKeyFn = getApiKey;
    this.getDiscoveredModelFn = getDiscoveredModel ?? (() => undefined);
    this.hookRegistry = hookRegistry ?? null;

    // Build memory engine
    if (config.memory) {
      this.memoryEngine = new MemoryEngine(config.memory);
    }

    // Build context engine
    if (config.contextEngine) {
      this.contextEngine = new ContextEngine(config.contextEngine);
    }

    // Build tools
    const memoryTools = this.memoryEngine?.createMemoryTools() || [];
    const toolNames = config.tools
      ? resolveToolNames(config.tools)
      : [];

    // Safety enforcement: while `allowDisableHitl` is false (the default —
    // "Dangerous Fully Auto" off), every agent MUST have ask_user and
    // confirm_action regardless of what its saved Tools node lists. This
    // guarantees that agents created before HITL shipped (or configs that
    // drift from the default) still get the human-gate tools.
    // When `allowDisableHitl` is true, the user has explicitly opted out,
    // so we respect whatever the agent config contains.
    if (!this.safetySettings.allowDisableHitl) {
      if (!toolNames.includes('ask_user')) toolNames.push('ask_user');
      if (!toolNames.includes('confirm_action')) toolNames.push('confirm_action');
    }
    const workspaceCwd = config.workspacePath ?? process.cwd();
    // OpenRouter key is resolved lazily — the ApiKeyStore (populated via config:setApiKeys)
    // is the primary source; env var is a fallback. All other API-key env
    // fallbacks now live inside the relevant tool module's resolveContext.
    const getOpenrouterApiKey = async () => {
      const fromStore = await getApiKey('openrouter');
      return fromStore || process.env.OPENROUTER_API_KEY;
    };
    // HITL tool context: the ask_user tool is created once, but sessionKey
    // and the broadcast target vary over the runtime's lifetime — capture
    // them as late-binding references.
    const hitlContext = this.hitlRegistry
      ? {
        agentId: config.id,
        getSessionKey: () => this.currentSessionKey,
        registry: this.hitlRegistry,
        emit: (event: ServerEvent) => {
          this.broadcastFn?.(event);
        },
      }
      : undefined;

    let tools = createAgentTools(
      toolNames,
      memoryTools as AgentTool<TSchema>[],
      undefined,
      {
        cwd: workspaceCwd,
        sandboxWorkdir: config.sandboxWorkdir,
        getOpenrouterApiKey,
        modelId: config.modelId,
        hitl: hitlContext,
        agentConfig: config,
      },
    );

    // Wrap tools with hook invocation if registry is provided
    if (this.hookRegistry) {
      tools = this.wrapToolsWithHooks(tools, config.id);
    }

    // Build the system prompt via the single source of truth. This is
    // the same function `SystemPromptPreview` calls via REST, so the
    // panel and the outbound payload can never drift.
    this.resolvedSystemPrompt = resolveOutboundSystemPrompt({
      config,
      safetySettings: this.safetySettings,
      workspaceCwd,
    });
    const systemPrompt = this.resolvedSystemPrompt.assembled;

    const plugin = this.pluginRegistry?.get(config.provider.pluginId);
    const runtimeProviderId = plugin?.runtimeProviderId ?? config.provider.pluginId;

    const model = resolveRuntimeModel({
      provider: config.provider,
      runtimeProviderId,
      modelId: config.modelId,
      modelCapabilities: config.modelCapabilities,
      getDiscoveredModel: this.getDiscoveredModelFn,
    });

    // Snapshot base tools so addTools can reset per-run injections
    this.baseTools = tools;
    // Cache the finalized system prompt so `buildInitialBreakdown()`
    // can tokenize it without reaching into pi-core's Agent state
    // (which may swap it per-turn via setSystemPrompt).
    this.initialSystemPrompt = systemPrompt;

    // Create Agent
    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: config.thinkingLevel as any,
        tools,
        messages: [],
      },
      transformContext: this.contextEngine?.buildTransformContext(),
      getApiKey,
      toolExecution: 'parallel',
      streamFn: wrappedStreamFn,
      onPayload: (payload) => {
        log('pi-ai Request Payload', summarizePayload(payload));
        // Predictive context-window signal: tokenize the outbound
        // payload, split into four mutually-exclusive sections
        // (systemPrompt, skills, tools, messages), and emit before the
        // HTTP call. The coordinator wraps this into a `context:usage`
        // event with source='preview'. `actual` snapshots reuse the
        // non-messages counts from this preview so the UI keeps a
        // stable breakdown across the turn.
        const skillInputs =
          this.config.tools?.skills?.map((s) => ({
            name: s.name ?? s.id ?? '(unnamed)',
            content: s.content ?? '',
          })) ?? [];
        const breakdown = estimatePayloadBreakdown(payload, skillInputs);
        const contextWindow =
          (payload as { model?: { contextWindow?: number } })?.model?.contextWindow
          ?? (this.agent.state.model as { contextWindow?: number })?.contextWindow
          ?? 0;
        this.emit({
          type: 'context_usage_preview',
          estimatedTokens: breakdown.total,
          contextWindow,
          breakdown: {
            systemPrompt: breakdown.systemPrompt,
            skills: breakdown.skills,
            tools: breakdown.tools,
            messages: breakdown.messages,
            skillsEntries: breakdown.skillsEntries,
            toolsEntries: breakdown.toolsEntries,
          },
        });
      },
    });

    // Forward agent events to runtime listeners
    this.unsubscribeAgent = this.agent.subscribe((event: AgentEvent) => {
      this.emit(event);
    });

    this.emit({ type: 'runtime_ready', config });
  }

  // ---------------------------------------------------------------------------
  // Hook-driven runtime mutations
  // ---------------------------------------------------------------------------

  /**
   * Swap the model for the next prompt call. Called by RunCoordinator
   * after before_model_resolve hook fires with overrides.
   */
  setModel(runtimeProviderId: string, modelId: string): void {
    const model = resolveRuntimeModel({
      provider: this.config.provider,
      runtimeProviderId,
      modelId,
      modelCapabilities: this.config.modelCapabilities,
      getDiscoveredModel: this.getDiscoveredModelFn,
    });

    this.agent.state.model = model;
    log('AgentRuntime', `Model swapped to ${runtimeProviderId}/${modelId}`);
  }

  /**
   * Override the system prompt for the next prompt call. Called by
   * RunCoordinator after before_prompt_build hook fires with overrides.
   */
  setSystemPrompt(prompt: string): void {
    this.agent.state.systemPrompt = prompt;
  }

  /**
   * Compute a baseline context-usage breakdown for this agent before
   * any turn has run. Uses the finalized system prompt + resolved base
   * tools + configured skills; `messages` is 0. Used to seed a
   * session's persisted `contextBreakdown` so the UI can show the
   * per-section panel the moment a session is opened, without waiting
   * for the first preview.
   */
  buildInitialBreakdown(): import('../../shared/context-usage').ContextUsageBreakdown {
    const skillInputs =
      this.config.tools?.skills?.map((s) => ({
        name: s.name ?? s.id ?? '(unnamed)',
        content: s.content ?? '',
      })) ?? [];
    // Synthesize the same payload shape the provider will see so the
    // breakdown is consistent with the per-turn preview.
    const payload = {
      systemPrompt: this.initialSystemPrompt,
      messages: [],
      tools: this.baseTools,
    };
    const b = estimatePayloadBreakdown(payload, skillInputs);
    return {
      systemPrompt: b.systemPrompt,
      skills: b.skills,
      tools: b.tools,
      messages: b.messages,
      skillsEntries: b.skillsEntries,
      toolsEntries: b.toolsEntries,
    };
  }

  /** Sum the four aggregate buckets of a breakdown for total context tokens. */
  buildInitialContextTokens(): number {
    const b = this.buildInitialBreakdown();
    return b.systemPrompt + b.skills + b.tools + b.messages;
  }

  /**
   * Return the system prompt as pi-ai will send it, broken into
   * sections. `SystemPromptPreview` reads this (via the persisted
   * `SessionStoreEntry.resolvedSystemPrompt`) so the panel matches
   * the outbound payload exactly.
   */
  getResolvedSystemPrompt(): ResolvedSystemPrompt {
    return this.resolvedSystemPrompt;
  }

  /**
   * Get the current system prompt text. Used by RunCoordinator to
   * apply prepend/append overrides from before_prompt_build hook.
   */
  getSystemPrompt(): string {
    return this.agent.state.systemPrompt;
  }

  /**
   * Set the current session key. Called by RunCoordinator before each
   * `prompt()` so HITL tools (`ask_user`) can register pending prompts
   * against the correct session.
   */
  setCurrentSessionKey(sessionKey: string): void {
    this.currentSessionKey = sessionKey;
  }

  /**
   * Get the current session key. Useful for tool-scoped logging and for
   * coordinator code that needs to address the HITL registry.
   */
  getCurrentSessionKey(): string {
    return this.currentSessionKey;
  }

  /**
   * Inject the function that sends events to the agent's connected sockets.
   * Called by AgentManager after the EventBridge is constructed so HITL
   * tools can push `hitl:input_required` / `hitl:resolved` to clients
   * without going through the coordinator's run-scoped stream.
   */
  setBroadcast(fn: (event: ServerEvent) => void): void {
    this.broadcastFn = fn;
  }

  /**
   * Cancel every pending HITL prompt for a session and broadcast the
   * resolution. Called by RunCoordinator.abort() so the UI's banner clears
   * even when the run is torn down before the tool's own abort handler
   * fires.
   */
  cancelPendingHitl(sessionKey: string, reason: 'aborted' | 'timeout'): void {
    if (!this.hitlRegistry) return;
    const cancelled = this.hitlRegistry.cancelAllForSession(
      this.config.id,
      sessionKey,
      reason,
    );
    for (const entry of cancelled) {
      this.broadcastFn?.({
        type: 'hitl:resolved',
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
        toolCallId: entry.toolCallId,
        outcome: 'cancelled',
        reason,
      });
    }
  }

  setSessionContext(messages: AgentMessage[]): void {
    this.agent.state.messages = [...messages];
  }

  /**
   * Replace per-run tools on the agent (e.g. session tools). Resets to
   * base tools first so repeated calls don't accumulate duplicates.
   */
  addTools(tools: AgentTool<TSchema>[]): void {
    this.agent.state.tools = [...this.baseTools, ...tools];
  }

  setActiveSession(sessionManager: SessionManager | null): void {
    this.contextEngine?.setActiveSession(sessionManager, (summary) => {
      this.emit({ type: 'memory_compaction', summary });
    });
  }

  clearActiveSession(): void {
    this.contextEngine?.clearActiveSession();
  }

  /**
   * Run the configured compaction strategy against an externally
   * supplied message list. Used by the manual-compaction REST path,
   * which operates outside of an active run. Returns the compacted
   * messages; when no context engine is configured the input is
   * returned unchanged.
   */
  async runContextCompaction(messages: AgentMessage[]): Promise<AgentMessage[]> {
    if (!this.contextEngine) {
      return messages;
    }
    return this.contextEngine.compact(messages);
  }

  // ---------------------------------------------------------------------------
  // Tool hook wrapping
  // ---------------------------------------------------------------------------

  /**
   * Wrap each tool's execute function with before_tool_call / after_tool_call
   * hook invocations. This is done once at creation time.
   */
  private wrapToolsWithHooks(
    tools: AgentTool<TSchema>[],
    agentId: string,
  ): AgentTool<TSchema>[] {
    const registry = this.hookRegistry!;

    return tools.map((tool) => {
      const originalExecute = tool.execute;

      const wrappedExecute: typeof tool.execute = async (
        toolCallId: string,
        params: any,
        signal?: AbortSignal,
      ) => {
        // --- before_tool_call ---
        const beforeCtx: BeforeToolCallContext = {
          agentId,
          runId: '', // runId not available at tool level; set by coordinator if needed
          toolCallId,
          toolName: tool.name,
          params: params ?? {},
          blocked: false,
          blockReason: undefined,
        };

        await registry.invoke(HOOK_NAMES.BEFORE_TOOL_CALL, beforeCtx);

        if (beforeCtx.blocked) {
          return {
            content: [{ type: 'text' as const, text: `Blocked: ${beforeCtx.blockReason ?? 'blocked by hook'}` }],
            details: undefined,
          };
        }

        // Execute the original tool
        const result = await originalExecute(toolCallId, beforeCtx.params, signal);

        // --- after_tool_call ---
        const resultText = result.content
          ?.map((c: any) => ('text' in c ? c.text : ''))
          .join('') ?? '';

        const afterCtx: AfterToolCallContext = {
          agentId,
          runId: '',
          toolCallId,
          toolName: tool.name,
          params: beforeCtx.params,
          result: resultText,
          isError: isToolErrorDetails(result.details),
          transformedResult: undefined,
        };

        await registry.invoke(HOOK_NAMES.AFTER_TOOL_CALL, afterCtx);

        // If transformed, replace the result
        if (afterCtx.transformedResult !== undefined) {
          return {
            content: [{ type: 'text' as const, text: afterCtx.transformedResult }],
            details: result.details,
          };
        }

        return result;
      };

      return { ...tool, execute: wrappedExecute };
    });
  }

  // ---------------------------------------------------------------------------
  // Core runtime API
  // ---------------------------------------------------------------------------

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the runtime
      }
    }
  }

  subscribe(fn: RuntimeEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async prompt(text: string, attachments?: ImageAttachment[]): Promise<void> {
    this.lastApiError = null;
    const originalFetch = globalThis.fetch;
    // The wrapper is swapped into globalThis.fetch for the duration of the
    // whole prompt(). Restoring it inside the wrapper's own `finally` (as a
    // previous revision did) would unwrap after the very first fetch, so
    // subsequent turns in the same agent loop would bypass logging.
    globalThis.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as URL | Request).toString();
      log('pi-ai Fetch', `[START] URL: ${url}`);

      const init = args[1] as RequestInit | undefined;
      const requestHeaders = headersToRecord(init?.headers);
      const requestBody = typeof init?.body === 'string' ? init.body : undefined;

      try {
        const response = await originalFetch(...args);
        log('pi-ai Fetch', `[STATUS] ${response.status} ${response.statusText}`);
        const responseHeaders = headersToRecord(response.headers);

        if (!response.ok) {
          // Non-2xx: small error body, safe to await without blocking a stream.
          const clone = response.clone();
          let bodyText = '';
          try {
            bodyText = await clone.text();
            const parsed = JSON.parse(bodyText);
            if (typeof parsed?.error?.message === 'string') {
              this.lastApiError = parsed.error.message;
            }
          } catch {
            // ignore parse failures
          }
          const file = logApiExchange({
            url,
            requestHeaders,
            requestBody,
            status: response.status,
            statusText: response.statusText,
            responseHeaders,
            responseBody: bodyText,
          });
          log('pi-ai Fetch', `[RAW] Full exchange written to ${file}`);
        } else {
          const clone = response.clone();
          // Never await the cloned body here: doing so buffers the full stream
          // before returning the Response and breaks live token streaming.
          void clone.text()
            .then((bodyText) => {
              const file = logApiExchange({
                url,
                requestHeaders,
                requestBody,
                status: response.status,
                statusText: response.statusText,
                responseHeaders,
                responseBody: bodyText,
              });
              log('pi-ai Fetch', `[RAW] Full exchange written to ${file}`);
            })
            .catch((err) => {
              log('pi-ai Fetch', `[BODY_ERROR] ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('pi-ai Fetch', `[ERROR] ${message}`);
        logApiExchange({
          url,
          requestHeaders,
          requestBody,
          error: message,
        });
        throw err;
      }
    };

    try {
      const images = attachments?.map((a) => ({ type: 'image' as const, data: a.data, mimeType: a.mimeType }));
      await this.agent.prompt(text, images?.length ? images : undefined);

      // After-turn bookkeeping
      if (this.contextEngine) {
        await this.contextEngine.afterTurn(this.agent.state.messages);
      }
    } catch (error) {
      this.emit({
        type: 'runtime_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  abort() {
    this.agent.abort();
  }

  destroy() {
    this.abort();
    this.clearActiveSession();
    this.unsubscribeAgent?.();
    this.listeners.clear();
  }

  get state() {
    return this.agent.state;
  }
}
