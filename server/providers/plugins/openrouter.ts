import { definePluginEntry } from '../../../shared/plugin-sdk';
import type { DiscoveredModelMetadata } from '../../../shared/agent-config';
import type { ProviderModelMap } from '../../../shared/model-catalog';

function mapOpenRouterModel(entry: any): DiscoveredModelMetadata {
  return {
    id: entry.id,
    provider: 'openrouter',
    name: entry.name,
    description: entry.description,
    reasoningSupported:
      Array.isArray(entry.supported_parameters) &&
      entry.supported_parameters.includes('reasoning'),
    inputModalities: entry.architecture?.input_modalities ?? ['text'],
    contextWindow: entry.context_length,
    maxTokens: entry.top_provider?.max_completion_tokens,
    cost: {
      input: Number(entry.pricing?.prompt ?? 0),
      output: Number(entry.pricing?.completion ?? 0),
      cacheRead: Number(entry.pricing?.cache_read ?? 0),
      cacheWrite: Number(entry.pricing?.cache_write ?? 0),
    },
    outputModalities: entry.architecture?.output_modalities ?? ['text'],
    tokenizer: entry.architecture?.tokenizer ?? undefined,
    supportedParameters: Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : undefined,
    topProvider: entry.top_provider
      ? {
          contextLength: entry.top_provider.context_length,
          maxCompletionTokens: entry.top_provider.max_completion_tokens,
          isModerated: entry.top_provider.is_moderated,
        }
      : undefined,
    raw: entry,
  };
}

export const openrouterPlugin = definePluginEntry({
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Access 200+ models through OpenRouter',
  runtimeProviderId: 'openrouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  auth: [
    {
      methodId: 'api-key',
      label: 'API Key',
      type: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      usesSavedKey: true,
      validate: async (key, baseUrl, signal) => {
        const url = `${baseUrl}/models?limit=1`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        return res.ok;
      },
    },
  ],
  catalog: {
    refresh: async (ctx) => {
      const [fullResponse, userResponse] = await Promise.all([
        fetch(`${ctx.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          signal: ctx.signal,
        }),
        fetch(`${ctx.baseUrl}/models/user`, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          signal: ctx.signal,
        }),
      ]);

      if (!fullResponse.ok) {
        throw new Error(`OpenRouter model fetch failed: ${fullResponse.status}`);
      }

      const fullBody = await fullResponse.json();
      const models = Object.fromEntries(
        (fullBody.data ?? []).map((entry: any) => {
          const model = mapOpenRouterModel(entry);
          return [model.id, model];
        }),
      ) as ProviderModelMap;

      let userModels: ProviderModelMap = {};
      if (userResponse.ok) {
        const userBody = await userResponse.json();
        userModels = Object.fromEntries(
          (userBody.data ?? []).map((entry: any) => {
            const fullModel = models[entry.id];
            const model = fullModel ?? mapOpenRouterModel(entry);
            return [model.id, model];
          }),
        ) as ProviderModelMap;
      }

      return { models, userModels };
    },
  },
  streamFamily: 'openrouter-thinking',
  // wrapStreamFn, webSearch, webFetch — deferred to a follow-up when
  // the actual stream wrapper infrastructure is connected to pi-agent-core
});
