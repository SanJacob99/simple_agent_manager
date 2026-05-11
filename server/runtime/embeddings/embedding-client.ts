import type { ResolvedVectorEmbeddingConfig } from '../../../shared/agent-config';
import type { RuntimeHints } from '../../tools/tool-module';
import { OpenRouterEmbeddingClient } from './openrouter-embedding-client';
import { OllamaEmbeddingClient } from './ollama-embedding-client';

export interface EmbeddingClient {
  readonly provider: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
  dimensions(): number | null;
}

export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(
      `${provider} API key not configured. Set it in Settings or via the appropriate environment variable.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export class EmbeddingRequestError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} embedding request failed: ${detail}`);
    this.name = 'EmbeddingRequestError';
  }
}

export function createEmbeddingClient(
  cfg: ResolvedVectorEmbeddingConfig,
  runtime: RuntimeHints,
): EmbeddingClient {
  switch (cfg.provider) {
    case 'openrouter':
      return new OpenRouterEmbeddingClient(cfg, runtime);
    case 'ollama':
      return new OllamaEmbeddingClient(cfg);
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`Unsupported embedding provider: ${_exhaustive}`);
    }
  }
}
