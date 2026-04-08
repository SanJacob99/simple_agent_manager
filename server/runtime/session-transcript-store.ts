import fs from 'fs/promises';
import { SessionManager, type SessionEntry, type SessionHeader } from '@mariozechner/pi-coding-agent';

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
