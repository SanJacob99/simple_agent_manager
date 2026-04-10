import { definePluginEntry } from '../../../shared/plugin-sdk';

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
    },
  ],
  // catalog, stream, web — added in Task 7
});
