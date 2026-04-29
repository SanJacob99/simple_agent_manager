import { randomUUID } from 'crypto';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { SessionRouter } from './session-router';
import type { StorageEngine } from '../storage/storage-engine';
import type { SessionTranscriptStore } from './session-transcript-store';
import type { SubAgentRegistry } from '../agents/sub-agent-registry';
import type { RunCoordinator } from '../agents/run-coordinator';
import { SESSION_TOOL_NAMES } from '../../shared/resolve-tool-names';

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
          const projectedSize = used + JSON.stringify(rendered).length + 2; // ", " overhead
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

function createSessionsSpawnTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_spawn',
    description: 'Spawn a sub-agent session. Creates a new sub-session and dispatches a message to it.',
    label: 'Sessions Spawn',
    parameters: Type.Object({
      targetAgentId: Type.Optional(
        Type.String({ description: 'Agent ID to spawn (defaults to self)' }),
      ),
      message: Type.String({ description: 'Initial message for the sub-agent' }),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for the sub-agent reply (default: false)' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Timeout in ms when waiting' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const targetAgentId = (params.targetAgentId as string | undefined) ?? ctx.callerAgentId;
        const message = params.message as string;
        const shouldWait = params.wait === true;
        const timeoutMs = params.timeoutMs as number | undefined;

        const subSessionKey = `sub:${ctx.callerSessionKey}:${randomUUID()}`;

        // Resolve the coordinator for the target agent
        let targetCoordinator: RunCoordinator | null;
        if (targetAgentId === ctx.callerAgentId) {
          targetCoordinator = ctx.coordinator;
        } else {
          targetCoordinator = ctx.coordinatorLookup(targetAgentId);
        }

        if (!targetCoordinator) {
          return textResult(`Error: no coordinator found for agent "${targetAgentId}"`);
        }

        const dispatchResult = await targetCoordinator.dispatch({
          sessionKey: subSessionKey,
          text: message,
        });

        const record = ctx.subAgentRegistry.spawn(
          { sessionKey: ctx.callerSessionKey, runId: ctx.callerRunId },
          { agentId: targetAgentId, sessionKey: subSessionKey, runId: dispatchResult.runId },
        );

        if (!shouldWait) {
          return textResult(JSON.stringify({
            spawned: true,
            subAgentId: record.subAgentId,
            sessionKey: subSessionKey,
            runId: dispatchResult.runId,
          }));
        }

        const waitResult = await targetCoordinator.wait(dispatchResult.runId, timeoutMs);
        const replyText = waitResult.payloads
          .filter((p) => p.type === 'text')
          .map((p) => p.content)
          .join('\n');

        return textResult(replyText || `(no text reply, status: ${waitResult.status})`);
      } catch (e) {
        return textResult(`Error spawning sub-agent: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsYieldTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_yield',
    description: 'Signal that you are yielding execution until all sub-agents complete.',
    label: 'Sessions Yield',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        ctx.subAgentRegistry.setYieldPending(
          ctx.callerSessionKey,
          {
            parentAgentId: ctx.callerAgentId,
            parentRunId: ctx.callerRunId,
            timeoutMs: 10 * 60 * 1000,
          },
          () => undefined,
        );
        return textResult('Yield pending — execution will pause until all sub-agents complete.');
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

  if (ctx.subAgentSpawning) {
    if (isEnabled('sessions_spawn')) {
      tools.push(createSessionsSpawnTool(ctx));
    }
    if (isEnabled('sessions_yield')) {
      tools.push(createSessionsYieldTool(ctx));
    }
    if (isEnabled('subagents')) {
      tools.push(createSubagentsTool(ctx));
    }
  }

  return tools;
}
