import { getModel, getModels } from '@mariozechner/pi-ai';
import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
  ResolvedProviderConfig,
} from '../../shared/agent-config';

interface ResolveRuntimeModelArgs {
  provider: ResolvedProviderConfig;
  runtimeProviderId: string;
  modelId: string;
  modelCapabilities: ModelCapabilityOverrides;
  baseUrl?: string;
  getDiscoveredModel: (
    provider: string,
    modelId: string,
  ) => DiscoveredModelMetadata | undefined;
}

function applyCapabilityOverrides(
  model: Model<Api>,
  overrides: ModelCapabilityOverrides,
): Model<Api> {
  return {
    ...model,
    reasoning: overrides.reasoningSupported ?? model.reasoning,
    input: overrides.inputModalities ?? model.input,
    contextWindow: overrides.contextWindow ?? model.contextWindow,
    maxTokens: overrides.maxTokens ?? model.maxTokens,
    cost: overrides.cost ?? model.cost,
  };
}

export function resolveRuntimeModel(args: ResolveRuntimeModelArgs): Model<Api> {
  const pid = args.runtimeProviderId;

  const builtIn = (
    getModel as (provider: string, modelId: string) => Model<Api> | undefined
  )(pid, args.modelId);

  if (builtIn) {
    const model = applyCapabilityOverrides(builtIn, args.modelCapabilities);
    if (args.baseUrl) {
      return { ...model, baseUrl: args.baseUrl };
    }
    return model;
  }

  const discovered = args.getDiscoveredModel(pid, args.modelId);
  const template = (
    getModels as (provider: string) => Model<Api>[]
  )(pid)[0];

  if (!template) {
    throw new Error(`No model template available for provider: ${pid}`);
  }

  const model = applyCapabilityOverrides(
    {
      ...template,
      id: args.modelId,
      name: args.modelId,
      reasoning: discovered?.reasoningSupported ?? false,
      input: discovered?.inputModalities ?? template.input,
      contextWindow: discovered?.contextWindow ?? template.contextWindow,
      maxTokens: discovered?.maxTokens ?? template.maxTokens,
      cost: discovered?.cost ?? template.cost,
    },
    args.modelCapabilities,
  );

  if (args.baseUrl) {
    return { ...model, baseUrl: args.baseUrl };
  }
  return model;
}
