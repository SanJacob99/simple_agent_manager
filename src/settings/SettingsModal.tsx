import { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from './settings-store';

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

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-100">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* API Keys */}
        <div className="max-h-[60vh] overflow-y-auto p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            API Keys
          </h3>
          <div className="space-y-3">
            {PROVIDERS.map(({ id, label }) => (
              <div key={id}>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  {label}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type={visible[id] ? 'text' : 'password'}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                    value={apiKeys[id] || ''}
                    onChange={(e) => setApiKey(id, e.target.value)}
                    placeholder={id === 'ollama' ? 'Not required for local' : `Enter ${label} API key`}
                  />
                  <button
                    onClick={() => toggle(id)}
                    className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-500 transition hover:text-slate-300"
                  >
                    {visible[id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[10px] text-slate-600">
            Keys are stored in your browser's localStorage. They never leave your device.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-5 py-3">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
