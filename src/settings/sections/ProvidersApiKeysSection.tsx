import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../settings-store';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'groq', label: 'Groq' },
  { id: 'xai', label: 'xAI' },
  { id: 'ollama', label: 'Ollama (local)' },
];

export default function ProvidersApiKeysSection() {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const setApiKey = useSettingsStore((state) => state.setApiKey);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      {PROVIDERS.map(({ id, label }) => (
        <label key={id} className="block">
          <span className="mb-1 block text-sm font-medium text-slate-300">
            {label}
          </span>
          <div className="flex gap-2">
            <input
              type={visible[id] ? 'text' : 'password'}
              value={apiKeys[id] ?? ''}
              onChange={(event) => setApiKey(id, event.target.value)}
              placeholder={
                id === 'ollama'
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
        </label>
      ))}

      <p className="text-xs text-slate-500">
        Keys are stored in your browser&apos;s local storage and never leave
        this device.
      </p>
    </div>
  );
}
