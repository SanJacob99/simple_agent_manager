import fs from 'node:fs/promises';
import type { StorageEngine } from '../storage/storage-engine';
import type {
  ChannelSessionMeta,
  AgentCommSealReason,
  AgentCommAuditEvent,
  AgentSendMessageMeta,
} from '../../shared/agent-comm-types';
import type { SessionStoreEntry } from '../../shared/storage-types';
import { canonicalChannelKey, parseChannelKey } from './channel-key';

export interface OpenArgs {
  pair: [string, string];
  pairNames: [string, string];
}

export interface ChannelHandle {
  key: string;
  meta: ChannelSessionMeta;
}

export interface AppendUserArgs {
  content: string;
  meta: AgentSendMessageMeta;
}

export interface ChannelSessionStoreOpts {
  ownerStorage: (ownerAgentId: string) => StorageEngine | undefined;
}

/**
 * Facade over StorageEngine that manages channel-session entries.
 *
 * A channel-session is a pair-level session between two agents. Its entry
 * lives in the lo-sorted agent's StorageEngine, keyed by the canonical
 * channel key (e.g. `channel:alpha:beta`). The transcript is a JSONL file
 * with user/assistant/tool messages plus `agent-comm-audit` events.
 */
export class ChannelSessionStore {
  constructor(private readonly opts: ChannelSessionStoreOpts) {}

  private storageFor(ownerAgentId: string): StorageEngine {
    const s = this.opts.ownerStorage(ownerAgentId);
    if (!s) throw new Error(`channel store: owner storage unavailable for ${ownerAgentId}`);
    return s;
  }

  /**
   * Derive the lo-sorted agent ID from a channel key.
   * The entry always lives in the storage returned for this agent ID;
   * this must equal meta.ownerAgentId (enforced by open()).
   */
  private ownerOf(key: string): string {
    const [lo] = parseChannelKey(key);
    return lo;
  }

  /** Load the SessionStoreEntry for a channel key, or return null. */
  private async loadEntry(key: string): Promise<SessionStoreEntry | null> {
    const storage = this.storageFor(this.ownerOf(key));
    return storage.getSession(key);
  }

  /**
   * Append a raw JSONL line to the channel transcript.
   * StorageEngine does not expose appendTranscriptEvent directly, so we
   * write to the JSONL file ourselves using the same path the engine
   * would resolve.
   */
  private async appendTranscriptLine(entry: SessionStoreEntry, record: unknown): Promise<void> {
    const storage = this.storageFor(entry.agentId);
    const transcriptPath = storage.resolveTranscriptPath(entry);
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(transcriptPath, line, 'utf-8');
  }

  /**
   * Persist updated channelMeta back into the session store and return
   * the updated meta.
   */
  private async persistMeta(
    key: string,
    meta: ChannelSessionMeta,
  ): Promise<ChannelSessionMeta> {
    const storage = this.storageFor(this.ownerOf(key));
    await storage.updateSession(key, {
      channelMeta: meta,
      updatedAt: meta.lastActivityAt,
    });
    return meta;
  }

  /**
   * Open (or resume) a channel session. If the channel-session entry
   * already exists in the owner's StorageEngine, return it. Otherwise
   * create a fresh one with zero-state meta.
   *
   * The pair is sorted internally so that `meta.ownerAgentId === entry.agentId
   * === lo-sorted agent` regardless of caller-provided order (spec §6.4).
   * `pairNames` are re-aligned to match the sorted pair order.
   */
  async open(args: OpenArgs): Promise<ChannelHandle> {
    const [a, b] = args.pair;
    const [aName, bName] = args.pairNames;
    const swap = a > b;
    const lo = swap ? b : a;
    const hi = swap ? a : b;
    const loName = swap ? bName : aName;
    const hiName = swap ? aName : bName;
    const key = canonicalChannelKey(lo, hi);
    const storage = this.storageFor(lo);

    const existing = await storage.getSession(key);
    if (existing?.channelMeta) {
      return { key, meta: existing.channelMeta };
    }

    const now = new Date().toISOString();
    const meta: ChannelSessionMeta = {
      pair: [lo, hi],
      pairNames: [loName, hiName],
      ownerAgentId: lo,
      turns: 0,
      tokensIn: 0,
      tokensOut: 0,
      sealed: false,
      sealedReason: null,
      lastActivityAt: now,
    };

    // sessionId is derived from the key for stable file naming
    const sessionId = key.replace(/:/g, '-');

    const entry: SessionStoreEntry = {
      sessionKey: key,
      sessionId,
      agentId: lo,
      // No sessionFile — resolveTranscriptPath will use `${sessionId}.jsonl`
      createdAt: now,
      updatedAt: now,
      chatType: 'direct',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
      channelMeta: meta,
    };

    await storage.createSession(entry);
    return { key, meta };
  }

  /**
   * Read the current state of an existing channel session.
   * Throws if the channel does not exist.
   */
  async read(key: string): Promise<ChannelHandle> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }
    return { key, meta: entry.channelMeta };
  }

  /**
   * Append a user-role message to the channel transcript and bump the
   * turn counter. Throws if the channel is sealed.
   */
  async appendUserMessage(key: string, args: AppendUserArgs): Promise<ChannelSessionMeta> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }

    const { channelMeta } = entry;
    if (channelMeta.sealed) {
      throw new Error(`channel-session-store: channel is sealed (${channelMeta.sealedReason}): ${key}`);
    }

    const now = new Date().toISOString();

    // Append the transcript event
    const record = {
      type: 'message',
      id: `chan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      parentId: null,
      timestamp: now,
      message: {
        role: 'user',
        content: args.content,
      },
      channelMeta: args.meta,
    };
    await this.appendTranscriptLine(entry, record);

    // Update meta
    const updatedMeta: ChannelSessionMeta = {
      ...channelMeta,
      turns: channelMeta.turns + 1,
      lastActivityAt: now,
    };

    return this.persistMeta(key, updatedMeta);
  }

  /**
   * Append an audit event to the channel transcript (does NOT bump turns).
   */
  async appendAudit(key: string, event: AgentCommAuditEvent): Promise<void> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }
    await this.appendTranscriptLine(entry, event);
  }

  /**
   * Accumulate token usage for a channel session.
   */
  async addUsage(
    key: string,
    usage: { tokensIn: number; tokensOut: number },
  ): Promise<ChannelSessionMeta> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }

    const { channelMeta } = entry;
    const now = new Date().toISOString();
    const updatedMeta: ChannelSessionMeta = {
      ...channelMeta,
      tokensIn: channelMeta.tokensIn + usage.tokensIn,
      tokensOut: channelMeta.tokensOut + usage.tokensOut,
      lastActivityAt: now,
    };

    return this.persistMeta(key, updatedMeta);
  }

  /**
   * Seal the channel: mark as sealed, persist reason, and append a
   * `sealed` audit event to the transcript (per spec §6.4/§6.5).
   */
  async seal(key: string, reason: AgentCommSealReason): Promise<ChannelSessionMeta> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }

    const now = new Date().toISOString();
    const updatedMeta: ChannelSessionMeta = {
      ...entry.channelMeta,
      sealed: true,
      sealedReason: reason,
      lastActivityAt: now,
    };

    // Append sealed audit event to the transcript first
    const auditEvent: AgentCommAuditEvent = {
      kind: 'agent-comm-audit',
      ts: now,
      event: { type: 'sealed', reason },
    };
    await this.appendTranscriptLine(entry, auditEvent);

    return this.persistMeta(key, updatedMeta);
  }

  /**
   * Return the last `limit` JSONL records from the channel transcript.
   * Reads the full JSONL file and slices from the end — suitable for
   * modest channel transcripts (agent-comm channels are expected to be
   * short-lived and bounded by turn limits).
   */
  async tail(key: string, limit: number): Promise<unknown[]> {
    const entry = await this.loadEntry(key);
    if (!entry?.channelMeta) {
      throw new Error(`channel-session-store: channel not found: ${key}`);
    }

    const storage = this.storageFor(this.ownerOf(key));
    const transcriptPath = storage.resolveTranscriptPath(entry);

    let raw: string;
    try {
      raw = await fs.readFile(transcriptPath, 'utf-8');
    } catch {
      return [];
    }

    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const tail = limit > 0 ? lines.slice(-limit) : lines;

    return tail.map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return l;
      }
    });
  }
}
