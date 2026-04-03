import { PROVIDERS, STATIC_MODELS } from '../../runtime/provider-model-options';
import { useGraphStore } from '../../store/graph-store';
import { useSettingsStore } from '../settings-store';
import type { ThinkingLevel } from '../../types/nodes';

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export default function DefaultsSection() {
  const agentDefaults = useSettingsStore((state) => state.agentDefaults);
  const setAgentDefaults = useSettingsStore((state) => state.setAgentDefaults);
  const applyAgentDefaultsToExistingAgents = useGraphStore(
    (state) => state.applyAgentDefaultsToExistingAgents,
  );

  const confirmApply = () => {
    const approved = window.confirm(
      'Apply provider, model, thinking level, and system prompt to all existing agents? This does not change names, descriptions, tags, capabilities, or peripheral links.',
    );
    if (approved) {
      applyAgentDefaultsToExistingAgents();
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Provider
        </span>
        <select
          aria-label="Provider"
          value={agentDefaults.provider}
          onChange={(event) => {
            const provider = event.target.value;
            setAgentDefaults({
              provider,
              modelId: STATIC_MODELS[provider]?.[0] ?? '',
            });
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Model
        </span>
        <select
          aria-label="Model"
          value={agentDefaults.modelId}
          onChange={(event) =>
            setAgentDefaults({ modelId: event.target.value })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {(STATIC_MODELS[agentDefaults.provider] ?? []).map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Thinking Level
        </span>
        <select
          aria-label="Thinking Level"
          value={agentDefaults.thinkingLevel}
          onChange={(event) =>
            setAgentDefaults({
              thinkingLevel: event.target.value as ThinkingLevel,
            })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          System Prompt
        </span>
        <textarea
          aria-label="System Prompt"
          value={agentDefaults.systemPrompt}
          onChange={(event) =>
            setAgentDefaults({ systemPrompt: event.target.value })
          }
          rows={8}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
      </label>

      <button
        type="button"
        onClick={confirmApply}
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/15"
      >
        Apply defaults to existing agents
      </button>
    </div>
  );
}
