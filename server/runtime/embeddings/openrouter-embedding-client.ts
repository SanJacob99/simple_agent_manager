import type { ResolvedVectorEmbeddingConfig } from '../../../shared/agent-config';
import type { RuntimeHints } from '../../tools/tool-module';
import {
  type EmbeddingClient,
  EmbeddingRequestError,
  MissingApiKeyError,
} from './embedding-client';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message?: string };
}

export class OpenRouterEmbeddingClient implements EmbeddingClient {
  readonly provider = 'openrouter';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly getKey: () => Promise<string | undefined> | string | undefined;
  private resolvedDimensions: number | null;

  constructor(cfg: ResolvedVectorEmbeddingConfig, runtime: RuntimeHints) {
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.resolvedDimensions = cfg.dimensions ?? null;
    this.getKey =
      runtime.getOpenrouterApiKey ?? (() => process.env.OPENROUTER_API_KEY);
  }

  dimensions(): number | null {
    return this.resolvedDimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const key = await this.getKey();
    if (!key) throw new MissingApiKeyError('OpenRouter');

    const url = `${this.baseUrl}/embeddings`;
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.resolvedDimensions) {
      body.dimensions = this.resolvedDimensions;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new EmbeddingRequestError('OpenRouter', `network error: ${msg}`);
    }

    const rawText = await response.text();
    let parsed: OpenAIEmbeddingResponse;
    try {
      parsed = JSON.parse(rawText) as OpenAIEmbeddingResponse;
    } catch {
      throw new EmbeddingRequestError(
        'OpenRouter',
        `HTTP ${response.status}: ${rawText.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      const message = parsed.error?.message ?? rawText.slice(0, 200);
      throw new EmbeddingRequestError(
        'OpenRouter',
        `HTTP ${response.status}: ${message}`,
      );
    }
    if (!parsed.data || !Array.isArray(parsed.data)) {
      throw new EmbeddingRequestError('OpenRouter', 'malformed response: missing data array');
    }

    const ordered = [...parsed.data].sort((a, b) => a.index - b.index);
    const vectors = ordered.map((d) => d.embedding);
    if (vectors.length > 0 && this.resolvedDimensions === null) {
      this.resolvedDimensions = vectors[0].length;
    }
    return vectors;
  }
}
