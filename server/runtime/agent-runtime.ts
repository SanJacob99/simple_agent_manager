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
import { log } from '../logger';
import type { HitlRegistry } from '../hitl/hitl-registry';
import type { ServerEvent } from '../../shared/protocol';
import { DEFAULT_SAFETY_SETTINGS, type SafetySettings } from '../storage/settings-file-store';

export type RuntimeEvent =
  | AgentEvent
  | { type: 'runtime_ready'; config: AgentConfig }
  | { type: 'runtime_error'; error: string }
  | { type: 'memory_compaction'; summary: string };

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
    const xaiApiKey = config.xaiApiKey || process.env.XAI_API_KEY;
    const tavilyApiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
    // OpenRouter key is resolved lazily — the ApiKeyStore (populated via config:setApiKeys)
    // is the primary source; env var is a fallback.
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
        xaiApiKey,
        xaiModel: config.xaiModel,
        tavilyApiKey,
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

    // Build system prompt — inject the runtime workspace path when the config
    // didn't have one (workingDirectory was empty, so no workspace section was built).
    let systemPrompt = config.systemPrompt.assembled;
    if (workspaceCwd && !/Working directory: /.test(systemPrompt)) {
      systemPrompt += `\n\n## Workspace\n\nWorking directory: ${workspaceCwd}`;
    }

    // Confirmation policy — appended whenever either HITL tool is present in
    // the resolved tool list. Teaches the model WHEN to call `confirm_action`
    // / `ask_user` and enforces the one-tool-call-per-confirm-turn rule that
    // keeps parallel-tool-calling providers from bypassing the gate.
    const hasHitlTool = toolNames.includes('confirm_action') || toolNames.includes('ask_user');
    const policy = this.safetySettings.confirmationPolicy?.trim();
    if (hasHitlTool && policy) {
      systemPrompt += `\n\n${policy}`;
    }

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
      onPayload: (payload) => {
        log('pi-ai Request Payload', summarizePayload(payload));
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
    globalThis.fetch = async (...args) => {
      log('pi-ai Fetch', `[START] URL: ${args[0]}`);
      try {
        const response = await originalFetch(...args);
        log('pi-ai Fetch', `[STATUS] ${response.status} ${response.statusText}`);
        if (!response.ok) {
          // Non-2xx: small error body, safe to await without blocking a stream.
          const clone = response.clone();
          try {
            const bodyText = await clone.text();
            log('pi-ai Fetch', `[BODY] ${bodyText.substring(0, 1000)}`);
            const parsed = JSON.parse(bodyText);
            if (typeof parsed?.error?.message === 'string') {
              this.lastApiError = parsed.error.message;
            }
          } catch {
            // ignore parse failures
          }
        } else {
          const clone = response.clone();
          // Never await the cloned body here: doing so buffers the full stream
          // before returning the Response and breaks live token streaming.
          void clone.text()
            .then((bodyText) => {
              log('pi-ai Fetch', `[BODY] ${bodyText.substring(0, 1000)}`);
            })
            .catch((err) => {
              log('pi-ai Fetch', `[BODY_ERROR] ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        return response;
      } catch (err) {
        log('pi-ai Fetch', `[ERROR] ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        globalThis.fetch = originalFetch;
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
