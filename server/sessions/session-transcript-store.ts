import fs from 'fs/promises';
import { SessionManager, type SessionEntry, type SessionHeader } from '@mariozechner/pi-coding-agent';
import type { BranchTree, ForkPoint } from '../../shared/storage-types';

export interface CreatedTranscriptSession {
  manager: SessionManager;
  sessionId: string;
  sessionFile: string;
}

export class SessionTranscriptStore {
  constructor(
    private readonly sessionsDir: string,
    private readonly cwd: string,
  ) {}

  async createSession(parentSessionFile?: string): Promise<CreatedTranscriptSession> {
    await fs.mkdir(this.sessionsDir, { recursive: true });

    const manager = SessionManager.create(this.cwd, this.sessionsDir);
    if (parentSessionFile) {
      manager.newSession({ parentSession: parentSessionFile });
    }

    return this.provisionAndReopen(manager);
  }

  openSession(sessionFile: string): SessionManager {
    return SessionManager.open(sessionFile, this.sessionsDir, this.cwd);
  }

  async snapshot(manager: SessionManager): Promise<SessionManager> {
    const sessionFile = manager.getSessionFile();
    const header = manager.getHeader();

    if (!sessionFile || !header) {
      throw new Error('Cannot snapshot a session without a persisted file and header');
    }

    await this.writeSnapshot(sessionFile, header, manager.getEntries());
    return this.openSession(sessionFile);
  }

  readTranscript(sessionFile: string): SessionEntry[] {
    return this.openSession(sessionFile).getEntries();
  }

  buildBranchTree(sessionFile: string): BranchTree {
    const entries = this.readTranscript(sessionFile);
    const messageEntries = entries.filter((e) => e.type === 'message' || e.type === 'compaction');

    if (messageEntries.length === 0) {
      return { forkPoints: [], defaultPath: [], totalEntries: 0 };
    }

    // Build adjacency list: parentId -> children
    const children = new Map<string | null, typeof messageEntries>();
    for (const entry of messageEntries) {
      const parentId = entry.parentId;
      if (!children.has(parentId)) {
        children.set(parentId, []);
      }
      children.get(parentId)!.push(entry);
    }

    // Find fork points (entries with >1 child)
    const forkPoints: ForkPoint[] = [];
    for (const [parentId, kids] of children) {
      if (kids.length > 1 && parentId !== null) {
        const parentEntry = messageEntries.find((e) => e.id === parentId);
        forkPoints.push({
          entryId: parentId,
          timestamp: parentEntry?.timestamp ?? '',
          branches: kids.map((kid, i) => {
            // Count entries on this branch
            let count = 0;
            let current: string | undefined = kid.id;
            while (current) {
              count++;
              const nextChildren = children.get(current);
              current = nextChildren?.[nextChildren.length - 1]?.id;
            }

            const msg = kid.message as { role?: string; content?: unknown } | undefined;
            const content = typeof msg?.content === 'string' ? msg.content : '';
            const preview = content.slice(0, 100);

            return {
              branchId: kid.id,
              label: `Branch ${i + 1}`,
              preview,
              timestamp: kid.timestamp,
              entryCount: count,
            };
          }),
        });
      }
    }

    // Build default path (follow latest child at each fork)
    const defaultPath: string[] = [];
    const roots = children.get(null) ?? [];
    let current = roots[roots.length - 1];
    while (current) {
      defaultPath.push(current.id);
      const kids = children.get(current.id);
      current = kids?.[kids.length - 1];
    }

    return {
      forkPoints,
      defaultPath,
      totalEntries: messageEntries.length,
    };
  }

  private async provisionAndReopen(manager: SessionManager): Promise<CreatedTranscriptSession> {
    const sessionFile = manager.getSessionFile();
    const header = manager.getHeader();

    if (!sessionFile || !header) {
      throw new Error('SessionManager did not provide a persisted session file');
    }

    await this.writeSnapshot(sessionFile, header, manager.getEntries());

    const reopened = this.openSession(sessionFile);
    return {
      manager: reopened,
      sessionId: reopened.getSessionId(),
      sessionFile,
    };
  }

  private async writeSnapshot(
    sessionFile: string,
    header: SessionHeader,
    entries: SessionEntry[],
  ): Promise<void> {
    const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
    await fs.writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf-8');
  }
}
