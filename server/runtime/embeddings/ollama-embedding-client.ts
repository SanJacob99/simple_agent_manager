import type { ResolvedVectorEmbeddingConfig } from '../../../shared/agent-config';
import {
  type EmbeddingClient,
  EmbeddingRequestError,
} from './embedding-client';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

export class OllamaEmbeddingClient implements EmbeddingClient {
  readonly provider = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private resolvedDimensions: number | null;

  constructor(cfg: ResolvedVectorEmbeddingConfig) {
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.resolvedDimensions = cfg.dimensions ?? null;
  }

  dimensions(): number | null {
    return this.resolvedDimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/api/embed`;
    const body = {
      model: this.model,
      input: texts,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new EmbeddingRequestError(
        'Ollama',
        `not reachable at ${this.baseUrl}. Is 'ollama serve' running? (${msg})`,
      );
    }

    const rawText = await response.text();
    let parsed: OllamaEmbedResponse;
    try {
      parsed = JSON.parse(rawText) as OllamaEmbedResponse;
    } catch {
      throw new EmbeddingRequestError(
        'Ollama',
        `HTTP ${response.status}: ${rawText.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      throw new EmbeddingRequestError(
        'Ollama',
        `HTTP ${response.status}: ${parsed.error ?? rawText.slice(0, 200)}`,
      );
    }
    if (!parsed.embeddings || !Array.isArray(parsed.embeddings)) {
      throw new EmbeddingRequestError('Ollama', 'malformed response: missing embeddings array');
    }

    if (parsed.embeddings.length > 0 && this.resolvedDimensions === null) {
      this.resolvedDimensions = parsed.embeddings[0].length;
    }
    return parsed.embeddings;
  }
}
