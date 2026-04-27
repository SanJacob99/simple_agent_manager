import type { ResolvedContextEngineConfig } from '../../shared/agent-config';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { SessionManager, SessionEntry } from '@mariozechner/pi-coding-agent';
import { estimateMessagesTokens } from '../../shared/token-estimator';

/**
 * Number of most-recent tool results whose image blocks stay in context.
 * Older tool result images are replaced with a short text placeholder so the
 * base64 bytes stop travelling over the wire on every subsequent turn. Two
 * keeps the current screenshot and the one before it — usually enough for
 * "did that click do what I expected" comparisons without unbounded bloat.
 */
const KEEP_RECENT_IMAGE_TOOL_RESULTS = 2;

interface ToolResultLike {
  role?: unknown;
  content?: unknown;
}

function isToolResultWithImage(msg: ToolResultLike): boolean {
  if (msg.role !== 'toolResult' || !Array.isArray(msg.content)) return false;
  return msg.content.some(
    (block) =>
      block && typeof block === 'object' &&
      (block as { type?: unknown }).type === 'image',
  );
}

/**
 * Walks tool-result messages newest-to-oldest. The most recent
 * `keepRecent` tool results that carry images keep them intact;
 * anything older has its image blocks swapped for a short text
 * placeholder. The original messages are not mutated.
 *
 * Non-toolResult messages (user/assistant) pass through unchanged —
 * user-attached images are intentional and shouldn't be dropped
 * behind the user's back.
 */
export function stripStaleToolResultImages(
  messages: AgentMessage[],
  keepRecent: number,
): AgentMessage[] {
  if (keepRecent < 0) keepRecent = 0;

  let imagesSeen = 0;
  const resultInReverse: AgentMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as ToolResultLike;
    if (!isToolResultWithImage(msg)) {
      resultInReverse.push(messages[i]);
      continue;
    }

    if (imagesSeen < keepRecent) {
      imagesSeen += 1;
      resultInReverse.push(messages[i]);
      continue;
    }

    const content = msg.content as Array<{ type?: unknown } & Record<string, unknown>>;
    let droppedCount = 0;
    const rewritten = content.map((block) => {
      if (block && typeof block === 'object' && block.type === 'image') {
        droppedCount += 1;
        const savedPath = typeof block.savedPath === 'string' && block.savedPath.length > 0
          ? block.savedPath
          : null;
        const prefix = droppedCount === 1 ? '[screenshot' : `[screenshot #${droppedCount}`;
        const text = savedPath
          ? `${prefix} removed from context; reachable at ${savedPath}]`
          : `${prefix} removed from context to save tokens]`;
        return { type: 'text', text };
      }
      return block;
    });

    resultInReverse.push({ ...(messages[i] as object), content: rewritten } as unknown as AgentMessage);
  }

  return resultInReverse.reverse();
}

/**
 * ContextEngine implements the OpenClaw-inspired lifecycle:
 * assemble -> compact -> afterTurn
 *
 * It manages token budgets, compaction, and system prompt additions.
 */
export class ContextEngine {
  private config: ResolvedContextEngineConfig;
  private activeSession: {
    sessionManager: SessionManager;
    onCompaction?: (summary: string) => void;
  } | null = null;

  constructor(config: ResolvedContextEngineConfig) {
    this.config = config;
  }

  setActiveSession(
    sessionManager: SessionManager | null,
    onCompaction?: (summary: string) => void,
  ): void {
    this.activeSession = sessionManager
      ? { sessionManager, onCompaction }
      : null;
  }

  clearActiveSession(): void {
    this.activeSession = null;
  }

  /**
   * Assemble context within token budget.
   * Returns trimmed messages + estimated token count.
   */
  async assemble(
    messages: AgentMessage[],
  ): Promise<{
    messages: AgentMessage[];
    estimatedTokens: number;
  }> {
    const budget = this.config.tokenBudget - this.config.reservedForResponse;
    let assembled = stripStaleToolResultImages(messages, KEEP_RECENT_IMAGE_TOOL_RESULTS);

    const tokens = estimateMessagesTokens(assembled as Array<{ content?: string | unknown }>);

    if (tokens > budget) {
      assembled = await this.compact(assembled);
    }

    return {
      messages: assembled,
      estimatedTokens: estimateMessagesTokens(assembled as Array<{ content?: string | unknown }>),
    };
  }

  /**
   * Compact messages when context exceeds budget.
   * Applies the configured compaction strategy.
   */
  async compact(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const budget = this.config.tokenBudget - this.config.reservedForResponse;
    // Prefer the explicit post-compaction target when the graph sets
    // one; otherwise fall back to the hard budget ceiling. Clamp to
    // `budget` so a misconfigured target can't inflate the final size.
    const target = this.config.postCompactionTokenTarget != null
      ? Math.max(512, Math.min(this.config.postCompactionTokenTarget, budget))
      : budget;
    const strategy = this.config.compactionStrategy;

    if (strategy === 'trim-oldest') {
      // Remove oldest messages until within the post-compaction target.
      let result = [...messages];
      while (
        result.length > 2 &&
        estimateMessagesTokens(result as Array<{ content?: string | unknown }>) > target
      ) {
        result = result.slice(1);
      }
      if (result.length < messages.length) {
        this.persistCompaction(
          `[Compaction trimmed ${messages.length - result.length} older messages to reach the ${target}-token post-compaction target.]`,
          result.length,
          messages,
        );
      }
      return result;
    }

    if (strategy === 'sliding-window') {
      // Keep the most recent messages that fit within the target size.
      let result = [...messages];
      while (
        result.length > 2 &&
        estimateMessagesTokens(result as Array<{ content?: string | unknown }>) > target
      ) {
        result = result.slice(1);
      }
      if (result.length < messages.length) {
        this.persistCompaction(
          `[Compaction kept the newest ${result.length} messages and trimmed ${messages.length - result.length} older messages to reach the ${target}-token target.]`,
          result.length,
          messages,
        );
      }
      return result;
    }

    if (strategy === 'summary') {
      // Keep recent messages, summarize older ones. Honor the
      // post-compaction target by also trimming the "kept" tail
      // until it fits -- the summary message itself contributes
      // ~2KB of text but we account for it via the final pass.
      let keepCount = Math.max(4, Math.floor(messages.length * 0.3));
      let kept = messages.slice(-keepCount);
      while (
        kept.length > 2 &&
        estimateMessagesTokens(kept as Array<{ content?: string | unknown }>) > target
      ) {
        keepCount -= 1;
        kept = messages.slice(-keepCount);
      }
      const toSummarize = messages.slice(0, -keepCount);

      if (toSummarize.length === 0) return messages;

      // Create a summary message (simple text-based summary)
      const summaryParts: string[] = [];
      for (const msg of toSummarize) {
        const m = msg as { role?: string; content?: string | unknown };
        if (typeof m.content === 'string') {
          summaryParts.push(`${m.role}: ${m.content.slice(0, 150)}`);
        }
      }
      const summaryText = `[Summary of ${toSummarize.length} earlier messages]\n${summaryParts.join('\n').slice(0, 2000)}`;

      const summaryMsg: AgentMessage = {
        role: 'user',
        content: summaryText,
        timestamp: Date.now(),
      } as AgentMessage;

      this.persistCompaction(summaryText, kept.length, messages);

      return [summaryMsg, ...kept];
    }

    return messages;
  }

  /**
   * After-turn hook. Implements proactive, trigger-aware compaction so
   * the next turn starts with breathing room instead of waiting for
   * `assemble()` to fire only when the budget overflows.
   *
   * - `auto`: fires at 80% of the post-reservation budget (matches what
   *   the Context Engine property panel advertises).
   * - `threshold`: fires at `compactionThreshold * budget` (a 0–1 ratio
   *   the user sets in the panel).
   * - `manual`: never fires here; only the "Compact Now" button does.
   *
   * `assemble()`'s overflow check (`tokens > budget`) stays as the
   * safety net for when proactive compaction was skipped or insufficient.
   */
  async afterTurn(messages: AgentMessage[]): Promise<void> {
    const triggerTokens = this.resolveProactiveTriggerTokens();
    if (triggerTokens <= 0) return;

    const tokens = estimateMessagesTokens(
      messages as Array<{ content?: string | unknown }>,
    );
    if (tokens > triggerTokens) {
      await this.compact(messages);
    }
  }

  /**
   * Token count at which `afterTurn` should trigger proactive
   * compaction. Returns 0 when the configured mode shouldn't fire from
   * this hook (manual, or unrecognized modes).
   */
  private resolveProactiveTriggerTokens(): number {
    const budget = this.config.tokenBudget - this.config.reservedForResponse;
    if (budget <= 0) return 0;

    if (this.config.compactionTrigger === 'auto') {
      return budget * 0.8;
    }
    if (this.config.compactionTrigger === 'threshold') {
      const ratio = Math.max(0, Math.min(1, this.config.compactionThreshold));
      return budget * ratio;
    }
    return 0;
  }

  /**
   * Build the transformContext function for pi-agent-core Agent.
   */
  buildTransformContext(): (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]> {
    return async (messages: AgentMessage[]) => {
      const result = await this.assemble(messages);
      return result.messages;
    };
  }

  private getFirstKeptEntryId(keptCount: number): string | undefined {
    const branch = this.activeSession?.sessionManager.getBranch() ?? [];
    const messageEntries = branch.filter((entry) => this.isContextBearingEntry(entry));

    if (messageEntries.length === 0) {
      return undefined;
    }

    const startIndex = Math.max(0, messageEntries.length - keptCount);
    return messageEntries[startIndex]?.id ?? messageEntries[0]?.id;
  }

  private isContextBearingEntry(entry: SessionEntry): boolean {
    return entry.type === 'message'
      || entry.type === 'custom_message'
      || entry.type === 'branch_summary';
  }

  private persistCompaction(
    summary: string,
    keptCount: number,
    originalMessages: AgentMessage[],
  ): void {
    const firstKeptEntryId = this.getFirstKeptEntryId(keptCount);
    if (!this.activeSession || !firstKeptEntryId) {
      return;
    }

    const tokensBefore = estimateMessagesTokens(
      originalMessages as Array<{ content?: string | unknown }>,
    );
    this.activeSession.sessionManager.appendCompaction(
      summary,
      firstKeptEntryId,
      tokensBefore,
    );
    this.activeSession.onCompaction?.(summary);
  }


}
