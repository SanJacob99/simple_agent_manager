import type { ResolvedContextEngineConfig } from '../../shared/agent-config';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { SessionManager, SessionEntry } from '@mariozechner/pi-coding-agent';
import { estimateMessagesTokens } from '../../shared/token-estimator';

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
    let assembled = [...messages];

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
    const strategy = this.config.compactionStrategy;

    if (strategy === 'trim-oldest') {
      // Remove oldest messages until within budget
      let result = [...messages];
      while (
        result.length > 2 &&
        estimateMessagesTokens(result as Array<{ content?: string | unknown }>) > budget
      ) {
        result = result.slice(1);
      }
      if (result.length < messages.length) {
        this.persistCompaction(
          `[Compaction trimmed ${messages.length - result.length} older messages to stay within the token budget.]`,
          result.length,
          messages,
        );
      }
      return result;
    }

    if (strategy === 'sliding-window') {
      // Keep the most recent messages that fit within budget
      let result = [...messages];
      while (
        result.length > 2 &&
        estimateMessagesTokens(result as Array<{ content?: string | unknown }>) > budget
      ) {
        result = result.slice(1);
      }
      if (result.length < messages.length) {
        this.persistCompaction(
          `[Compaction kept the newest ${result.length} messages and trimmed ${messages.length - result.length} older messages.]`,
          result.length,
          messages,
        );
      }
      return result;
    }

    if (strategy === 'summary' || strategy === 'hybrid') {
      // Keep recent messages, summarize older ones
      const keepCount = Math.max(4, Math.floor(messages.length * 0.3));
      const toSummarize = messages.slice(0, -keepCount);
      const kept = messages.slice(-keepCount);

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
   * After-turn hook for post-turn bookkeeping.
   */
  async afterTurn(_messages: AgentMessage[]): Promise<void> {
    // Placeholder for future: save to memory, update stats, etc.
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
