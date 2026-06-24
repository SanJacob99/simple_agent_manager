import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIR = process.cwd();
const GRAPH_FILE = 'graph.json';

/**
 * On-the-wire shape of the single canvas blob. Mirrors `SerializedGraph`
 * in `src/store/storage.ts` so the same JSON travels between the client,
 * localStorage, and this server-authoritative store without remapping.
 *
 * `nodes` and `edges` are intentionally typed loosely here: the React
 * Flow node/edge types live under `src/` and must not be imported into
 * server code. The PUT /api/graph handler validates that both are arrays
 * before persisting.
 */
export interface PersistedGraph {
  id: string;
  version: number;
  graph: {
    nodes: unknown[];
    edges: unknown[];
  };
  updatedAt: number;
}

/**
 * Server-authoritative store for the single canvas blob, backed by a JSON
 * file on disk. Mirrors `SettingsFileStore`: `load()` returns `null` when
 * nothing has been persisted yet (first run / migration), and `save()`
 * creates the parent directory on demand.
 */
export class GraphFileStore {
  private readonly filePath: string;

  constructor(dir?: string) {
    this.filePath = path.join(dir ?? DEFAULT_DIR, GRAPH_FILE);
  }

  /**
   * Read the persisted canvas. Returns `null` when no file exists yet so
   * the client can migrate its localStorage cache upstream on first boot.
   */
  async load(): Promise<PersistedGraph | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as PersistedGraph;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async save(graph: PersistedGraph): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(graph, null, 2), 'utf-8');
  }

  getFilePath(): string {
    return this.filePath;
  }
}
