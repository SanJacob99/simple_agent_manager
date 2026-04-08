import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_DIR = path.join(os.homedir(), '.simple-agent-manager');
const SETTINGS_FILE = 'settings.json';

export interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: Record<string, unknown>;
  storageDefaults: Record<string, unknown>;
}

const EMPTY_SETTINGS: PersistedSettings = {
  apiKeys: {},
  agentDefaults: {},
  storageDefaults: {},
};

export class SettingsFileStore {
  private readonly filePath: string;

  constructor(dir?: string) {
    this.filePath = path.join(dir ?? DEFAULT_DIR, SETTINGS_FILE);
  }

  async load(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        apiKeys: parsed.apiKeys ?? {},
        agentDefaults: parsed.agentDefaults ?? {},
        storageDefaults: parsed.storageDefaults ?? {},
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_SETTINGS };
      }
      throw err;
    }
  }

  async save(settings: PersistedSettings): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  getFilePath(): string {
    return this.filePath;
  }
}
