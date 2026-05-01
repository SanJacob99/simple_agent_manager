import { randomUUID } from 'crypto';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { SessionRouter } from './session-router';
import type { StorageEngine } from '../storage/storage-engine';
import type { SessionTranscriptStore } from './session-transcript-store';
import type { SubAgentRegistry, SetYieldOpts, SetYieldResult } from '../agents/sub-agent-registry';
import type { RunCoordinator } from '../agents/run-coordinator';
import type { SubAgentExecutor } from '../agents/sub-agent-executor';
import { SESSION_TOOL_NAMES, resolveToolNames } from '../../shared/resolve-tool-names';
import type { AgentConfig, ResolvedSubAgentConfig } from '../../shared/agent-config';
import type { SubAgentSpawnData } from '../../shared/session-diagnostics';
import type { SubAgentSessionMeta } from '../../shared/sub-agent-types';
import { buildSyntheticAgentConfig } from '../agents/sub-agent-executor';

export interface SessionToolContext {
  callerSessionKey: string;
  callerAgentId: string;
  callerRunId: string;
  sessionRouter: SessionRouter;
  storageEngine: StorageEngine;
  transcriptStore: SessionTranscriptStore;
  coordinator: RunCoordinator;
  subAgentRegistry: SubAgentRegistry;
  coordinatorLookup: (agentId: string) => RunCoordinator | null;
  subAgentSpawning: boolean;
  enabledToolNames: string[];
  /**
   * Optional callback wired by RunCoordinator. Forwards to
   * SubAgentRegistry.setYieldPending; the coordinator owns the
   * dispatch of the resume turn (the tool does not need the payload).
   * Tests may stub it directly.
   */
  resolveYield?: (
    parentSessionKey: string,
    opts: SetYieldOpts,
  ) => SetYieldResult;
  /**
   * Sub-agent executor (Task 12) wired by RunCoordinator (Task 13). Used by
   * the rewritten sessions_spawn tool (Task 14) to dispatch a one-shot child
   * run alongside the parent's run, without occupying the parent's queue
   * slot. Optional so tests with no sub-agent surface can omit it.
   */
  subAgentExecutor?: SubAgentExecutor;
  /**
   * Register an abort handler for a child runId so that a REST kill or the
   * agent-facing `subagents({action:'kill'})` tool can abort the running
   * child by calling `coordinator.abort(childRunId)`.
   */
  registerSubAgentAbort?: (childRunId: string, fn: () => void) => void;
  /** Mirror of registerSubAgentAbort for cleanup after the child run finishes. */
  unregisterSubAgentAbort?: (childRunId: string) => void;
  /** Parent AgentConfig; required for spawn. Optional so tests without spawn can omit it. */
  parentAgentConfig?: AgentConfig;
  /** Declared sub-agents resolved from parent config; populated by RunCoordinator. */
  parentSubAgents?: ResolvedSubAgentConfig[];
  /** Persist immutable spawn audit entry on the parent's transcript. */
  persistSubAgentSpawn?: (data: SubAgentSpawnData) => Promise<void>;
  /** Persist mutable sub-agent metadata on the sub-session entry. */
  persistSubAgentMeta?: (sessionKey: string, meta: SubAgentSessionMeta) => Promise<void>;
}

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...(truncated)';
}

const HISTORY_MESSAGE_CHAR_CAP = 500;
const HISTORY_TOOL_CHAR_CAP = 200;
const HISTORY_TOTAL_CHAR_BUDGET = 12_000;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 200;
const YIELD_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function renderHistoryEntry(entry: any): Record<string, unknown> {
  if (entry.type === 'toolResult') {
    return {
      id: entry.id,
      type: 'toolResult',
      toolName: entry.toolName,
      timestamp: entry.timestamp,
      text: truncate(extractEntryText(entry.content), HISTORY_TOOL_CHAR_CAP),
    };
  }

  const role = entry.message?.role ?? 'unknown';
  return {
    id: entry.id,
    type: 'message',
    role,
    timestamp: entry.timestamp,
    text: truncate(extractEntryText(entry.message?.content), HISTORY_MESSAGE_CHAR_CAP),
  };
}

function extractEntryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        out += (block as any).text ?? '';
      } else if (block && typeof block === 'object' && (block as any).type === 'toolCall') {
        out += `\n[toolCall name=${(block as any).name}]`;
      }
    }
    return out;
  }
  if (content == null) return '';
  return String(content);
}

// --- Tool creators ---

function createSessionsListTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_list',
    description:
      'List sessions for this agent. Filters: kind, recency (minutes), label (substring of displayName, case-insensitive), agent (must equal caller agentId for now), preview (boolean — when true, results include preview text + messageCount; capped at 50 sessions).',
    label: 'Sessions List',
    parameters: Type.Object({
      kind: Type.Optional(
        Type.Union([
          Type.Literal('all'),
          Type.Literal('agent'),
          Type.Literal('cron'),
        ], { description: 'Filter sessions by kind (default: all)' }),
      ),
      recency: Type.Optional(
        Type.Number({ description: 'Only return sessions updated within this many minutes' }),
      ),
      label: Type.Optional(
        Type.String({ description: 'Substring match (case-insensitive) against displayName' }),
      ),
      agent: Type.Optional(
        Type.String({ description: 'Filter by agentId; must equal caller agentId in this version' }),
      ),
      preview: Type.Optional(
        Type.Boolean({ description: 'Include preview (first user message, ≤120 chars) + messageCount (count of role-bearing message entries — excludes tool results / compactions) per session. Capped at 50 sessions.' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const requestedAgent = params.agent as string | undefined;
        if (requestedAgent && requestedAgent !== ctx.callerAgentId) {
          return textResult(
            `Cross-agent listing is not yet supported; only the caller's own agentId ("${ctx.callerAgentId}") is accepted.`,
          );
        }

        let sessions = await ctx.sessionRouter.listSessions();

        const kind = (params.kind as string | undefined) ?? 'all';
        if (kind === 'agent') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('agent:'));
        } else if (kind === 'cron') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('cron:'));
        }

        if (params.recency != null) {
          // ⚡ Bolt Optimization: Compare ISO timestamp strings lexically instead of parsing multiple Date objects.
          const cutoffStr = new Date(Date.now() - (params.recency as number) * 60 * 1000).toISOString();
          sessions = sessions.filter((s) => s.updatedAt >= cutoffStr);
        }

        const label = params.label as string | undefined;
        if (label) {
          const needle = label.toLowerCase();
          sessions = sessions.filter(
            (s) => typeof s.displayName === 'string' && s.displayName.toLowerCase().includes(needle),
          );
        }

        const wantsPreview = params.preview === true;
        const previewCapped = wantsPreview ? sessions.slice(0, 50) : sessions;

        const summary = previewCapped.map((s) => {
          const base = {
            sessionKey: s.sessionKey,
            sessionId: s.sessionId,
            chatType: s.chatType,
            updatedAt: s.updatedAt,
            totalTokens: s.totalTokens,
            displayName: s.displayName,
          };
          if (!wantsPreview) return base;
          return { ...base, ...readPreview(ctx, s) };
        });

        return textResult(JSON.stringify(summary, null, 2));
      } catch (e) {
        return textResult(`Error listing sessions: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function readPreview(
  ctx: SessionToolContext,
  session: { sessionKey: string; sessionFile?: string } & Record<string, unknown>,
): { preview: string; messageCount: number } {
  try {
    const transcriptPath = ctx.storageEngine.resolveTranscriptPath(session as any);
    const entries = ctx.transcriptStore.readTranscript(transcriptPath);
    let messageCount = 0;
    let firstUserText: string | undefined;
    for (const entry of entries as any[]) {
      if (entry?.type !== 'message') continue;
      messageCount += 1;
      if (firstUserText === undefined && entry.message?.role === 'user') {
        const content = entry.message.content;
        if (typeof content === 'string') {
          firstUserText = content;
        } else if (Array.isArray(content)) {
          const textBlock = content.find((b: any) => b?.type === 'text' && typeof b.text === 'string');
          firstUserText = textBlock?.text;
        }
      }
    }
    const preview = (firstUserText ?? '').slice(0, 120);
    return { preview, messageCount };
  } catch {
    return { preview: '', messageCount: 0 };
  }
}

function createSessionsHistoryTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_history',
    description:
      'Read transcript entries from a session. Newest-first; paginate older with `before: <entryId>`. Messages truncated at 500 chars; tool results at 200 chars; total response capped near 12 000 chars (truncated:true + nextCursor when capped).',
    label: 'Sessions History',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'The session key to read history from' }),
      limit: Type.Optional(
        Type.Number({ description: `Max entries to return (default ${HISTORY_DEFAULT_LIMIT}, hard cap ${HISTORY_MAX_LIMIT})` }),
      ),
      before: Type.Optional(
        Type.String({ description: 'EntryId cursor — only entries strictly older than this id are returned' }),
      ),
      includeToolResults: Type.Optional(
        Type.Boolean({ description: 'Include toolResult entries (default true)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const sessionKey = params.sessionKey as string;
        const session = await ctx.sessionRouter.getStatus(sessionKey);
        if (!session) {
          return textResult(`Session not found: ${sessionKey}`);
        }

        const transcriptPath = ctx.storageEngine.resolveTranscriptPath(session);
        const rawEntries = ctx.transcriptStore.readTranscript(transcriptPath) as any[];

        const includeToolResults = params.includeToolResults !== false;
        const filtered = rawEntries.filter((e) => {
          if (e?.type === 'message') return true;
          if (e?.type === 'toolResult') return includeToolResults;
          return false;
        });

        const before = params.before as string | undefined;
        let chronological = filtered;
        if (before) {
          const idx = filtered.findIndex((e) => e?.id === before);
          if (idx === -1) {
            return textResult(`Cursor not found: ${before}`);
          }
          chronological = filtered.slice(0, idx);
        }

        const requestedLimit = typeof params.limit === 'number'
          ? Math.max(1, Math.min(params.limit, HISTORY_MAX_LIMIT))
          : HISTORY_DEFAULT_LIMIT;

        const slice = chronological.slice(-requestedLimit).reverse();

        const formatted: Array<Record<string, unknown>> = [];
        let used = 0;
        let truncated = false;

        for (const entry of slice) {
          const rendered = renderHistoryEntry(entry);
          // Estimator must match the actual serialization (pretty-printed below)
          // so the 12k budget reflects the real response size; compact stringify
          // under-counts indentation/newlines by ~6%.
          const projectedSize = used + JSON.stringify(rendered, null, 2).length + 2;
          // First entry is always admitted; per-entry caps (500/200 chars) keep
          // any single rendered entry well under HISTORY_TOTAL_CHAR_BUDGET.
          if (formatted.length > 0 && projectedSize > HISTORY_TOTAL_CHAR_BUDGET) {
            truncated = true;
            break;
          }
          formatted.push(rendered);
          used = projectedSize;
        }

        const nextCursor = formatted.length > 0
          ? (formatted[formatted.length - 1].id as string | undefined)
          : undefined;
        const exhaustedLeft = !truncated && formatted.length === slice.length
          && (chronological.length <= requestedLimit);

        return textResult(JSON.stringify({
          sessionKey,
          entries: formatted,
          nextCursor: exhaustedLeft ? undefined : nextCursor,
          truncated,
          totalEntries: filtered.length,
        }, null, 2));
      } catch (e) {
        return textResult(`Error reading history: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsSendTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_send',
    description: 'Send a message to a session. Optionally wait for the agent reply.',
    label: 'Sessions Send',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'Target session key' }),
      message: Type.String({ description: 'Message text to send' }),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for the agent reply (default: false)' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Timeout in ms when waiting (default: 30000)' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const sessionKey = params.sessionKey as string;
        const message = params.message as string;
        const shouldWait = params.wait === true;
        const timeoutMs = params.timeoutMs as number | undefined;

        const dispatchResult = await ctx.coordinator.dispatch({
          sessionKey,
          text: message,
        });

        if (!shouldWait) {
          return textResult(JSON.stringify({
            dispatched: true,
            runId: dispatchResult.runId,
            sessionId: dispatchResult.sessionId,
          }));
        }

        const waitResult = await ctx.coordinator.wait(dispatchResult.runId, timeoutMs);
        const replyText = waitResult.payloads
          .filter((p) => p.type === 'text')
          .map((p) => p.content)
          .join('\n');

        return textResult(replyText || `(no text reply, status: ${waitResult.status})`);
      } catch (e) {
        return textResult(`Error sending message: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

interface OverrideValues {
  modelId?: string;
  thinkingLevel?: string;
  systemPromptAppend?: string;
  enabledTools?: string[];
}

function validateOverrides(
  raw: Record<string, unknown>,
  sub: ResolvedSubAgentConfig,
): { error: string | null; values: OverrideValues } {
  const allowed = new Set<string>(sub.overridableFields);
  const out: OverrideValues = {};

  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      return {
        error: `Override "${key}" is not in the sub-agent "${sub.name}" allowlist (allowed: ${[...allowed].join(', ') || 'none'}).`,
        values: out,
      };
    }
  }

  if (typeof raw.modelId === 'string' && raw.modelId.trim()) {
    out.modelId = raw.modelId.trim();
  }
  if (typeof raw.thinkingLevel === 'string') {
    const ok = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    if (!ok.includes(raw.thinkingLevel)) {
      return { error: `Invalid thinkingLevel: ${raw.thinkingLevel}. Allowed: ${ok.join(', ')}.`, values: out };
    }
    out.thinkingLevel = raw.thinkingLevel;
  }
  if (typeof raw.systemPromptAppend === 'string' && raw.systemPromptAppend.trim()) {
    out.systemPromptAppend = raw.systemPromptAppend.trim();
  }
  if (Array.isArray(raw.enabledTools)) {
    const effective = resolveToolNames(sub.tools);
    const effectiveSet = new Set(effective);
    for (const t of raw.enabledTools) {
      if (typeof t !== 'string' || !effectiveSet.has(t)) {
        return {
          error: `Override enabledTools contains "${t}" which is not in the sub-agent's effective tools (${effective.join(', ') || 'none'}).`,
          values: out,
        };
      }
    }
    out.enabledTools = raw.enabledTools as string[];
  }
  return { error: null, values: out };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function createSessionsSpawnTool(ctx: SessionToolContext): AgentTool<TSchema> | null {
  const subAgents = ctx.parentSubAgents ?? [];
  if (subAgents.length === 0) {
    // No declared sub-agents -> tool not available.
    return null;
  }
  if (
    !ctx.parentAgentConfig
    || !ctx.subAgentExecutor
    || !ctx.registerSubAgentAbort
    || !ctx.unregisterSubAgentAbort
    || !ctx.persistSubAgentSpawn
    || !ctx.persistSubAgentMeta
  ) {
    // Required wiring from RunCoordinator missing — tool not registered.
    return null;
  }

  const subAgentNames = subAgents.map((s) => s.name);
  const parentAgentConfig = ctx.parentAgentConfig;
  const subAgentExecutor = ctx.subAgentExecutor;
  const registerAbort = ctx.registerSubAgentAbort;
  const unregisterAbort = ctx.unregisterSubAgentAbort;
  const persistSpawn = ctx.persistSubAgentSpawn;
  const persistMeta = ctx.persistSubAgentMeta;

  return {
    name: 'sessions_spawn',
    description:
      'Spawn one of the agent\'s declared sub-agents with a one-shot message. Returns the sub-agent\'s reply or a sub-agent id for async tracking.',
    label: 'Sessions Spawn',
    parameters: Type.Object({
      subAgent: Type.Union(
        subAgentNames.map((n) => Type.Literal(n)) as any,
        { description: 'Name of the sub-agent to dispatch' },
      ),
      message: Type.String({ description: 'Initial message for the sub-agent' }),
      overrides: Type.Optional(
        Type.Object({
          modelId: Type.Optional(Type.String()),
          thinkingLevel: Type.Optional(Type.String()),
          systemPromptAppend: Type.Optional(Type.String()),
          enabledTools: Type.Optional(Type.Array(Type.String())),
        }),
      ),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for the sub-agent reply (default true)' })),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params: any) => {
      try {
        const subName = params.subAgent as string;
        const sub = subAgents.find((s) => s.name === subName);
        if (!sub) {
          return textResult(`Unknown sub-agent: ${subName}. Declared: ${subAgentNames.join(', ')}.`);
        }

        const overrides = (params.overrides ?? {}) as Record<string, unknown>;
        const validation = validateOverrides(overrides, sub);
        if (validation.error) {
          return textResult(validation.error);
        }

        const message = params.message as string;
        const shouldWait = params.wait !== false;  // default true
        const timeoutMs = params.timeoutMs as number | undefined;

        const shortUuid = randomUUID().slice(0, 8);
        const subSessionKey = `sub:${ctx.callerSessionKey}:${subName}:${shortUuid}`;
        const childRunId = randomUUID();

        const syntheticConfig = buildSyntheticAgentConfig(parentAgentConfig, sub, {
          systemPromptAppend: validation.values.systemPromptAppend ?? '',
          modelIdOverride: validation.values.modelId,
          thinkingLevelOverride: validation.values.thinkingLevel,
          enabledToolsOverride: validation.values.enabledTools,
        });

        const record = ctx.subAgentRegistry.spawn(
          { sessionKey: ctx.callerSessionKey, runId: ctx.callerRunId },
          {
            agentId: ctx.callerAgentId,
            sessionKey: subSessionKey,
            runId: childRunId,
            subAgentName: subName,
            appliedOverrides: validation.values as Record<string, unknown>,
          },
        );

        // Persist immutable audit entry on parent transcript
        await persistSpawn({
          subAgentId: record.subAgentId,
          subAgentName: subName,
          subSessionKey,
          parentRunId: ctx.callerRunId,
          message,
          appliedOverrides: validation.values as Record<string, unknown>,
          modelId: syntheticConfig.modelId,
          providerPluginId: syntheticConfig.provider.pluginId,
          spawnedAt: Date.now(),
        });

        // Persist mutable metadata on the sub-session entry
        await persistMeta(subSessionKey, {
          subAgentId: record.subAgentId,
          subAgentName: subName,
          parentSessionKey: ctx.callerSessionKey,
          parentRunId: ctx.callerRunId,
          status: 'running',
          sealed: false,
          appliedOverrides: validation.values as Record<string, unknown>,
          modelId: syntheticConfig.modelId,
          providerPluginId: syntheticConfig.provider.pluginId,
          startedAt: record.startedAt,
        });

        const dispatchPromise = subAgentExecutor.dispatch({
          childRunId,
          childSessionKey: subSessionKey,
          syntheticConfig,
          message,
          onAbortRegister: (fn) => registerAbort(childRunId, fn),
        });

        if (!shouldWait) {
          dispatchPromise.then(
            (r) => {
              if (r.status === 'completed') ctx.subAgentRegistry.onComplete(childRunId, r.text ?? '');
              else if (r.status === 'aborted') {/* registry already updated by kill path */}
              else ctx.subAgentRegistry.onError(childRunId, r.error ?? 'unknown');
              unregisterAbort(childRunId);
            },
          );
          return textResult(JSON.stringify({
            spawned: true,
            subAgentId: record.subAgentId,
            sessionKey: subSessionKey,
            runId: childRunId,
          }));
        }

        const timed = timeoutMs ? withTimeout(dispatchPromise, timeoutMs) : dispatchPromise;
        const result = await timed;

        if (result.status === 'completed') {
          ctx.subAgentRegistry.onComplete(childRunId, result.text ?? '');
        } else if (result.status === 'error') {
          ctx.subAgentRegistry.onError(childRunId, result.error ?? 'unknown');
        }
        unregisterAbort(childRunId);

        if (result.status === 'error' && result.error) {
          return textResult(result.error);
        }
        return textResult(result.text || `(no text reply, status: ${result.status})`);
      } catch (e) {
        return textResult(`Error spawning sub-agent: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsYieldTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_yield',
    description:
      'End the current turn and wait for sub-agents spawned in this session to finish. Auto-resumes with their aggregated results as a new user turn. No-op when there are no running sub-agents. Optional timeoutMs (default 600000 = 10 min); on timeout the parent resumes with whatever results are available.',
    label: 'Sessions Yield',
    parameters: Type.Object({
      timeoutMs: Type.Optional(
        Type.Number({ description: 'Max wait before forced resume (default 600000)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        if (!ctx.resolveYield) {
          return textResult('Yield is not available in this context; ignoring.');
        }

        const timeoutMs = typeof params?.timeoutMs === 'number' && params.timeoutMs > 0
          ? params.timeoutMs
          : YIELD_DEFAULT_TIMEOUT_MS;

        const result = ctx.resolveYield(
          ctx.callerSessionKey,
          {
            parentAgentId: ctx.callerAgentId,
            parentRunId: ctx.callerRunId,
            timeoutMs,
          },
        );

        if (result.setupOk) {
          const running = ctx.subAgentRegistry
            .listForParent(ctx.callerSessionKey)
            .filter((r) => r.status === 'running').length;
          const timeoutSeconds = Math.round(timeoutMs / 1000);
          return textResult(
            `Yielded; will resume when ${running} sub-agent${running === 1 ? '' : 's'} complete (timeout = ${timeoutSeconds}s).`,
          );
        }

        if (result.reason === 'no-active-subs') {
          return textResult('No sub-agents pending; yield is a no-op.');
        }

        if (result.reason === 'already-pending') {
          return textResult('Yield already pending; ignoring.');
        }

        return textResult(`Could not yield: ${result.reason}`);
      } catch (e) {
        return textResult(`Error yielding: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSubagentsTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'subagents',
    description: 'Manage sub-agents: list, get status, or kill a sub-agent.',
    label: 'Sub-Agents',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('status'),
        Type.Literal('kill'),
      ], { description: 'Action to perform' }),
      subAgentId: Type.Optional(
        Type.String({ description: 'Sub-agent ID (required for status and kill)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const action = params.action as string;

        if (action === 'list') {
          const records = ctx.subAgentRegistry.listForParent(ctx.callerSessionKey);
          const summary = records.map((r) => ({
            subAgentId: r.subAgentId,
            targetAgentId: r.targetAgentId,
            sessionKey: r.sessionKey,
            status: r.status,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
          }));
          return textResult(JSON.stringify(summary, null, 2));
        }

        const subAgentId = params.subAgentId as string | undefined;
        if (!subAgentId) {
          return textResult('Error: subAgentId is required for status and kill actions.');
        }

        if (action === 'status') {
          const record = ctx.subAgentRegistry.get(subAgentId);
          if (!record) {
            return textResult(`Sub-agent not found: ${subAgentId}`);
          }
          return textResult(JSON.stringify(record, null, 2));
        }

        if (action === 'kill') {
          const killed = ctx.subAgentRegistry.kill(subAgentId);
          return textResult(killed
            ? `Sub-agent ${subAgentId} killed.`
            : `Could not kill sub-agent ${subAgentId} (not found or already stopped).`);
        }

        return textResult(`Unknown action: ${action}`);
      } catch (e) {
        return textResult(`Error managing sub-agents: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionStatusTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'session_status',
    description: 'Get status metadata for a session. Optionally set a model override.',
    label: 'Session Status',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'Session key to query' }),
      modelOverride: Type.Optional(
        Type.String({ description: 'If provided, set a new model override for the session' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const sessionKey = params.sessionKey as string;
        const modelOverride = params.modelOverride as string | undefined;

        if (modelOverride) {
          await ctx.sessionRouter.updateAfterTurn(sessionKey, { modelOverride });
        }

        const session = await ctx.sessionRouter.getStatus(sessionKey);
        if (!session) {
          return textResult(`Session not found: ${sessionKey}`);
        }

        return textResult(JSON.stringify(session, null, 2));
      } catch (e) {
        return textResult(`Error getting session status: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

/**
 * Create all session tools for the given context.
 * When subAgentSpawning is false, spawn/yield/subagents tools are excluded.
 */
export function createSessionTools(ctx: SessionToolContext): AgentTool<TSchema>[] {
  const enabledToolNames = new Set<string>(ctx.enabledToolNames);
  const sessionToolSet = new Set<string>(SESSION_TOOL_NAMES);
  const isEnabled = (toolName: string) =>
    sessionToolSet.has(toolName) && enabledToolNames.has(toolName);

  const tools: AgentTool<TSchema>[] = [];

  if (isEnabled('sessions_list')) {
    tools.push(createSessionsListTool(ctx));
  }
  if (isEnabled('sessions_history')) {
    tools.push(createSessionsHistoryTool(ctx));
  }
  if (isEnabled('sessions_send')) {
    tools.push(createSessionsSendTool(ctx));
  }
  if (isEnabled('session_status')) {
    tools.push(createSessionStatusTool(ctx));
  }

  if ((ctx.parentSubAgents?.length ?? 0) > 0) {
    if (isEnabled('sessions_spawn')) {
      const t = createSessionsSpawnTool(ctx);
      if (t) tools.push(t);
    }
  }

  if (ctx.subAgentSpawning) {
    if (isEnabled('sessions_yield')) {
      tools.push(createSessionsYieldTool(ctx));
    }
    if (isEnabled('subagents')) {
      tools.push(createSubagentsTool(ctx));
    }
  }

  return tools;
}
