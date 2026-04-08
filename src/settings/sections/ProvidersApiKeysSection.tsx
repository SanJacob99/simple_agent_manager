import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../settings-store';

const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'google-vertex',
    label: 'Google Vertex AI',
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'azure-openai-responses',
    label: 'Azure OpenAI',
    keyUrl: 'https://ai.azure.com/',
  },
  {
    id: 'groq',
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'xai',
    label: 'xAI',
    keyUrl: 'https://console.x.ai/',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    keyUrl: 'https://cloud.cerebras.ai/platform/api-keys',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    keyUrl: 'https://vercel.com/docs/ai-gateway/security/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
  },
];

export default function ProvidersApiKeysSection() {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const setApiKey = useSettingsStore((state) => state.setApiKey);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      {PROVIDERS.map(({ id, label, keyUrl }) => {
        const isLocalProvider = id === 'ollama';
        return (
          <label key={id} className="block">
            <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
            <div className="flex gap-2">
              <input
                type={visible[id] ? 'text' : 'password'}
                value={apiKeys[id] ?? ''}
                onChange={(event) => setApiKey(id, event.target.value)}
                placeholder={
                  isLocalProvider
                    ? 'Not required for local'
                    : `Enter ${label} API key`
                }
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  setVisible((current) => ({ ...current, [id]: !current[id] }))
                }
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
                aria-label={`Toggle ${label} key visibility`}
              >
                {visible[id] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {keyUrl ? (
              <p className="mt-1 text-xs text-slate-500">
                <a
                  href={keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 underline hover:text-blue-200"
                >
                  {`Get ${label} key`}
                </a>
                {' · '}
                Add it here to enable {label} models.
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Runs locally via your Ollama daemon. No cloud API key required.
              </p>
            )}
          </label>
        );
      })}

      <p className="text-xs text-slate-500">
        Keys are saved to a local settings file on this machine.
      </p>
    </div>
  );
}
