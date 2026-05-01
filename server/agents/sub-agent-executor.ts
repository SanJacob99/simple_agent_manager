import type { AgentConfig, ResolvedSubAgentConfig, ResolvedSystemPrompt } from '../../shared/agent-config';

export interface SubAgentSpawnOverrides {
  systemPromptAppend: string;
  modelIdOverride: string | undefined;
  thinkingLevelOverride: string | undefined;
  enabledToolsOverride: string[] | undefined;
}

/**
 * Build a runtime-ready AgentConfig for a single sub-agent spawn. Does not
 * mutate the parent or sub config.
 *
 * Inheritance for fields NOT present on ResolvedSubAgentConfig (memory,
 * connectors, agentComm, vectorDatabases, crons): always cleared on the
 * synthetic config — sub-agents do not own these resources.
 *
 * Inheritance for fields present on the sub: take the sub's value (already
 * resolved to inherit-from-parent at graph-resolution time).
 */
export function buildSyntheticAgentConfig(
  parent: AgentConfig,
  sub: ResolvedSubAgentConfig,
  overrides: SubAgentSpawnOverrides,
): AgentConfig {
  const modelId = overrides.modelIdOverride ?? sub.modelId;
  const thinkingLevel = overrides.thinkingLevelOverride ?? sub.thinkingLevel;

  const baseTools = sub.tools;
  const tools = overrides.enabledToolsOverride
    ? { ...baseTools, resolvedTools: [...overrides.enabledToolsOverride] }
    : baseTools;

  const subPromptText = sub.systemPrompt;
  const appendText = overrides.systemPromptAppend?.trim();
  const assembled = appendText ? `${subPromptText}\n\n${appendText}` : subPromptText;

  const systemPrompt: ResolvedSystemPrompt = {
    mode: 'manual',
    sections: [],
    assembled,
    userInstructions: subPromptText,
  };

  return {
    id: `${parent.id}::sub::${sub.name}`,
    version: parent.version,
    name: `${parent.name}/${sub.name}`,
    description: sub.description,
    tags: [],

    provider: sub.provider,
    modelId,
    thinkingLevel,
    systemPrompt,
    modelCapabilities: sub.modelCapabilities,

    memory: null,
    tools,
    contextEngine: null,             // sub-agents are one-shot; no compaction
    connectors: [],
    agentComm: [],
    storage: parent.storage,         // sub-sessions live under the parent's storage
    vectorDatabases: [],
    crons: [],
    mcps: sub.mcps,
    subAgents: sub.recursiveSubAgentsEnabled ? parent.subAgents : [],

    workspacePath: sub.workingDirectory || parent.workspacePath || null,
    sandboxWorkdir: parent.sandboxWorkdir,
    xaiApiKey: parent.xaiApiKey,
    xaiModel: parent.xaiModel,
    tavilyApiKey: parent.tavilyApiKey,
    openaiApiKey: parent.openaiApiKey,
    geminiApiKey: parent.geminiApiKey,
    imageModel: parent.imageModel,

    exportedAt: parent.exportedAt,
    sourceGraphId: parent.sourceGraphId,
    runTimeoutMs: parent.runTimeoutMs,
    showReasoning: parent.showReasoning,
    verbose: parent.verbose,
  };
}

export interface ChildRunResult {
  status: 'completed' | 'error' | 'aborted';
  text?: string;
  error?: string;
}

export interface ChildRunOptions {
  runId: string;
  sessionKey: string;
  syntheticConfig: AgentConfig;
  message: string;
  /**
   * The runtime layer SETS this on the options bag to register an abort hook.
   * The executor's outer abort path calls whatever value is currently on
   * `onAbort` at abort time — so the runtime can reassign it as needed.
   */
  onAbort: () => void;
  /** Forwarded to the executor's event bus, tagged with the child runId. */
  emit: (event: unknown) => void;
}

export type ChildRunFn = (opts: ChildRunOptions) => Promise<ChildRunResult>;

export interface SubAgentExecutorOpts {
  /**
   * Bridge to the actual runtime layer that constructs a runtime from
   * `syntheticConfig` and runs it to completion. The executor doesn't know
   * about pi-coding-agent or AgentRuntime directly; the bridge does.
   */
  runChild: ChildRunFn;
  /**
   * Event bus to forward run events onto so the WebSocket subscription path
   * (and future inline cards) can read them keyed by child runId.
   */
  eventBus: { emit: (event: unknown) => void };
}

export interface DispatchOpts {
  childRunId: string;
  childSessionKey: string;
  syntheticConfig: AgentConfig;
  message: string;
  /** Caller registers an abort handler so REST/tool kill paths can fire it. */
  onAbortRegister: (abortFn: () => void) => void;
}

/**
 * Runs a sub-agent invocation alongside the parent run. Bypasses the
 * RunConcurrencyController's queue/slot accounting — sub-agents are owned
 * by the parent's run lifecycle, not by the global queue.
 */
export class SubAgentExecutor {
  constructor(private readonly opts: SubAgentExecutorOpts) {}

  async dispatch(d: DispatchOpts): Promise<ChildRunResult> {
    let abortRequested = false;

    // Build a stable options bag so the runtime can reassign onAbort and the
    // executor's outer abort path will call whatever's currently on it.
    const childOpts: ChildRunOptions = {
      runId: d.childRunId,
      sessionKey: d.childSessionKey,
      syntheticConfig: d.syntheticConfig,
      message: d.message,
      onAbort: () => {},   // placeholder; the runtime layer typically reassigns this
      emit: (event) => {
        // Tag every emitted event with the child runId so subscribers can
        // filter (the inline card, the parent's WS stream).
        const tagged = typeof event === 'object' && event !== null
          ? { ...event, runId: d.childRunId }
          : { event, runId: d.childRunId };
        this.opts.eventBus.emit(tagged);
      },
    };

    d.onAbortRegister(() => {
      abortRequested = true;
      try { childOpts.onAbort(); } catch { /* defensive */ }
    });

    const result = await this.opts.runChild(childOpts);

    const finalResult: ChildRunResult =
      abortRequested && result.status !== 'aborted'
        ? { status: 'aborted' }
        : result;

    // Emit a lifecycle completion event tagged with the child runId so that
    // WebSocket subscribers and inline cards can observe the run finishing.
    this.opts.eventBus.emit({ type: 'run:completed', runId: d.childRunId, status: finalResult.status });

    return finalResult;
  }
}
