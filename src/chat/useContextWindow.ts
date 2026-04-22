import { useEffect, useMemo } from 'react';
import {
  buildProviderCatalogKey,
  useModelCatalogStore,
} from '../store/model-catalog-store';
import type { AgentConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { ContextUsage } from '../../shared/context-usage';
import {
  useContextUsageStore,
  selectContextUsage,
} from '../store/context-usage-store';

export type ContextSource = 'override' | 'catalog' | 'default';

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 4096;

export interface ContextWindowInfo {
  contextWindow: number;
  maxTokens: number;
  source: ContextSource;
}

/**
 * Resolves the effective context window size (in tokens) for an agent.
 * Priority: user override -> catalog metadata -> safe default (128K).
 *
 * This hook is purely about the *model's window*, not about how full it
 * is. For current fill, see {@link useSessionContextUsage}.
 */
export function useContextWindow(config: AgentConfig | null): ContextWindowInfo {
  const getModelMetadata = useModelCatalogStore((s) => s.getModelMetadata);

  return useMemo(() => {
    if (!config) {
      return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, source: 'default' as ContextSource };
    }

    if (config.modelCapabilities?.contextWindow) {
      return {
        contextWindow: config.modelCapabilities.contextWindow,
        maxTokens: config.modelCapabilities.maxTokens ?? DEFAULT_MAX_TOKENS,
        source: 'override' as ContextSource,
      };
    }

    const catalogModel = getModelMetadata(
      buildProviderCatalogKey(config.provider),
      config.modelId,
    );
    if (catalogModel?.contextWindow) {
      return {
        contextWindow: catalogModel.contextWindow,
        maxTokens: catalogModel.maxTokens ?? DEFAULT_MAX_TOKENS,
        source: 'catalog' as ContextSource,
      };
    }

    return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, source: 'default' as ContextSource };
  }, [config, getModelMetadata]);
}

/**
 * Return the latest {@link ContextUsage} snapshot for a session. The
 * backend is the authoritative source; this hook subscribes to the
 * client-side read-through cache fed by `context:usage` WS events.
 *
 * When the in-memory cache is empty, hydrates from the persisted
 * `SessionStoreEntry` so the gauge reflects the last known value even
 * before a new turn runs.
 */
export function useSessionContextUsage(
  sessionKey: string | null | undefined,
  contextWindow: number,
  sessionMeta: SessionStoreEntry | null | undefined,
): ContextUsage | undefined {
  const hydrate = useContextUsageStore((s) => s.hydrateFromSession);
  const usage = useContextUsageStore(selectContextUsage(sessionKey ?? null));

  useEffect(() => {
    if (!sessionKey || !sessionMeta) return;
    hydrate({
      sessionKey,
      contextTokens: sessionMeta.contextTokens ?? 0,
      contextWindow,
      inputTokens: sessionMeta.inputTokens,
      outputTokens: sessionMeta.outputTokens,
      cacheRead: sessionMeta.cacheRead,
      cacheWrite: sessionMeta.cacheWrite,
      totalTokens: sessionMeta.totalTokens,
      breakdown: sessionMeta.contextBreakdown,
    });
  }, [sessionKey, sessionMeta, contextWindow, hydrate]);

  return usage;
}
