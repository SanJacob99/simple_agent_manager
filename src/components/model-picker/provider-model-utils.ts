import { STATIC_MODELS } from '../../runtime/provider-model-options';
import type { DiscoveredModelMetadata } from '../../types/model-metadata';

export function modelSupportsTools(
  discovered: DiscoveredModelMetadata | undefined,
) {
  return discovered?.supportedParameters?.includes('tools') ?? false;
}

export function getModelOptions(
  provider: string,
  discovered: string[],
): string[] {
  return [...new Set([...(STATIC_MODELS[provider] ?? []), ...discovered])];
}

export function getDefaultModelId(
  provider: string,
  discovered: string[],
  openRouterModels: Record<string, DiscoveredModelMetadata> = {},
) {
  if (provider === 'openrouter') {
    const firstToolCapableModel = discovered.find((modelId) =>
      modelSupportsTools(openRouterModels[modelId]),
    );
    if (firstToolCapableModel) return firstToolCapableModel;
  }

  return getModelOptions(provider, discovered)[0] ?? '';
}

export function getCustomModelPlaceholder(provider: string) {
  if (provider === 'openrouter') {
    return 'xiaomi/mimo-v2-pro';
  }

  return 'provider-specific-model-id';
}

export function isCustomModelId(modelId: string, availableModels: string[]) {
  return !availableModels.includes(modelId);
}

interface FilterModelOptionsArgs {
  availableModels: string[];
  provider: string;
  search: string;
  discoveredModels: Record<string, DiscoveredModelMetadata>;
  showFreeOnly: boolean;
  requireTools: boolean;
  requireReasoning: boolean;
  requireImageInput: boolean;
}

export function filterModelOptions({
  availableModels,
  provider,
  search,
  discoveredModels,
  showFreeOnly,
  requireTools,
  requireReasoning,
  requireImageInput,
}: FilterModelOptionsArgs) {
  const normalizedSearch = search.trim().toLowerCase();
  const hasOpenRouterCatalog = Object.keys(discoveredModels).length > 0;

  return availableModels.filter((modelId) => {
    const model =
      provider === 'openrouter' ? discoveredModels[modelId] : undefined;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      modelId.toLowerCase().includes(normalizedSearch) ||
      model?.name?.toLowerCase().includes(normalizedSearch) ||
      model?.description?.toLowerCase().includes(normalizedSearch);

    if (!matchesSearch) return false;

    if (showFreeOnly) {
      if (!model?.cost) return false;
      const isFree =
        model.cost.input === 0 &&
        model.cost.output === 0 &&
        model.cost.cacheRead === 0 &&
        model.cost.cacheWrite === 0;
      if (!isFree) return false;
    }

    if (requireTools && hasOpenRouterCatalog && model && !modelSupportsTools(model)) {
      return false;
    }

    if (requireReasoning && !model?.reasoningSupported) {
      return false;
    }

    if (requireImageInput && !model?.inputModalities?.includes('image')) {
      return false;
    }

    return true;
  });
}
