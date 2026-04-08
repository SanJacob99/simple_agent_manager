import { useEffect } from 'react';
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
  const storageDefaults = useSettingsStore((state) => state.storageDefaults);
  const setStorageDefaults = useSettingsStore((state) => state.setStorageDefaults);
  const applyStorageDefaultsToExistingNodes = useGraphStore(
    (state) => state.applyStorageDefaultsToExistingNodes,
  );
  const systemPromptMode =
    agentDefaults.systemPromptMode === 'manual' ? 'manual' : 'append';

  useEffect(() => {
    if (agentDefaults.systemPromptMode !== systemPromptMode) {
      setAgentDefaults({ systemPromptMode });
    }
  }, [agentDefaults.systemPromptMode, setAgentDefaults, systemPromptMode]);

  const confirmApply = () => {
    const approved = window.confirm(
      'Apply provider, model, and thinking level to all existing agents? This does not change names, descriptions, tags, system prompts, capabilities, or peripheral links.',
    );
    if (approved) {
      applyAgentDefaultsToExistingAgents();
    }
  };

  const confirmApplyStorage = () => {
    const approved = window.confirm(
      'Apply the default storage path to all existing storage nodes? This will change where their data is expected to live.',
    );
    if (approved) {
      applyStorageDefaultsToExistingNodes();
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
          System Prompt Mode
        </span>
        <select
          aria-label="System Prompt Mode"
          value={systemPromptMode}
          onChange={(event) =>
            setAgentDefaults({ systemPromptMode: event.target.value as any })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          <option value="append">Append (add your instructions)</option>
          <option value="manual">Manual (full control)</option>
        </select>
      </label>

      {/* Append mode: summary + textarea */}
      {systemPromptMode === 'append' && (
        <div className="space-y-2">
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 italic">
              App-built sections are injected first. Your instructions are appended at the end.
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-300">
              Your Instructions
            </span>
            <textarea
              aria-label="Your Instructions"
              value={agentDefaults.systemPrompt}
              onChange={(event) =>
                setAgentDefaults({ systemPrompt: event.target.value })
              }
              rows={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              placeholder="Additional instructions appended after app-built sections..."
            />
          </label>
        </div>
      )}

      {/* Manual mode: warning + full textarea */}
      {systemPromptMode === 'manual' && (
        <div className="space-y-2">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300/90">
              You are fully responsible for the system prompt. No safety guardrails, tooling, workspace, or runtime metadata will be injected.
            </p>
          </div>
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
              placeholder="Your complete system prompt..."
            />
          </label>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Safety Guardrails
        </span>
        <textarea
          aria-label="Safety Guardrails"
          value={agentDefaults.safetyGuardrails}
          onChange={(event) =>
            setAgentDefaults({ safetyGuardrails: event.target.value })
          }
          rows={8}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
        <p className="mt-1 text-xs text-slate-500">
          Injected into every agent's system prompt in append mode.
        </p>
      </label>

      <div className="border-t border-slate-700/50 pt-4" />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Default Storage Path
        </span>
        <input
          type="text"
          aria-label="Default Storage Path"
          value={storageDefaults.storagePath}
          onChange={(event) =>
            setStorageDefaults({ storagePath: event.target.value })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          placeholder="e.g. ~/.simple-agent-manager/storage"
        />
        <p className="mt-1 text-xs text-slate-500">
          Root directory for new storage nodes. Supports ~ expansion.
        </p>
      </label>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={confirmApply}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/15"
        >
          Apply agent defaults
        </button>
        <button
          type="button"
          onClick={confirmApplyStorage}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60"
        >
          Apply storage default
        </button>
      </div>
    </div>
  );
}
