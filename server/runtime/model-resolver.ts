import { getModel, getModels } from '@mariozechner/pi-ai';
import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
} from '../../shared/agent-config';

interface ResolveRuntimeModelArgs {
  provider: string;
  modelId: string;
  modelCapabilities: ModelCapabilityOverrides;
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
  const builtIn = (
    getModel as (provider: string, modelId: string) => Model<Api> | undefined
  )(args.provider, args.modelId);

  if (builtIn) {
    return applyCapabilityOverrides(builtIn, args.modelCapabilities);
  }

  const discovered = args.getDiscoveredModel(args.provider, args.modelId);
  const template = (
    getModels as (provider: string) => Model<Api>[]
  )(args.provider)[0];

  if (!template) {
    throw new Error(`No model template available for provider: ${args.provider}`);
  }

  return applyCapabilityOverrides(
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
}
