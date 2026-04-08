import { useState, useEffect } from 'react';
import { PROVIDERS, STATIC_MODELS } from '../../runtime/provider-model-options';
import { useGraphStore } from '../../store/graph-store';
import { useSettingsStore } from '../settings-store';
import type { ThinkingLevel, CompactionStrategy, MemoryBackend } from '../../types/nodes';
import type { DefaultsSubTab } from '../types';

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const COMPACTION_STRATEGIES: CompactionStrategy[] = ['summary', 'sliding-window', 'trim-oldest', 'hybrid'];
const MEMORY_BACKENDS: MemoryBackend[] = ['builtin', 'external', 'cloud'];

const TABS: { id: DefaultsSubTab; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'storage', label: 'Storage' },
  { id: 'contextEngine', label: 'Context Engine' },
  { id: 'memory', label: 'Memory' },
  { id: 'cron', label: 'Cron' },
];

// --- Shared field components ---

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100';

// --- Agent sub-section ---

function AgentSubSection() {
  const agentDefaults = useSettingsStore((s) => s.agentDefaults);
  const setAgentDefaults = useSettingsStore((s) => s.setAgentDefaults);
  const applyAgentDefaultsToExistingAgents = useGraphStore((s) => s.applyAgentDefaultsToExistingAgents);

  const systemPromptMode = agentDefaults.systemPromptMode === 'manual' ? 'manual' : 'append';

  useEffect(() => {
    if (agentDefaults.systemPromptMode !== systemPromptMode) {
      setAgentDefaults({ systemPromptMode });
    }
  }, [agentDefaults.systemPromptMode, setAgentDefaults, systemPromptMode]);

  return (
    <div className="space-y-4">
      <Field label="Provider">
        <select
          aria-label="Provider"
          value={agentDefaults.provider}
          onChange={(e) => {
            const provider = e.target.value;
            setAgentDefaults({ provider, modelId: STATIC_MODELS[provider]?.[0] ?? '' });
          }}
          className={inputCls}
        >
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>

      <Field label="Model">
        <select
          aria-label="Model"
          value={agentDefaults.modelId}
          onChange={(e) => setAgentDefaults({ modelId: e.target.value })}
          className={inputCls}
        >
          {(STATIC_MODELS[agentDefaults.provider] ?? []).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      <Field label="Thinking Level">
        <select
          aria-label="Thinking Level"
          value={agentDefaults.thinkingLevel}
          onChange={(e) => setAgentDefaults({ thinkingLevel: e.target.value as ThinkingLevel })}
          className={inputCls}
        >
          {THINKING_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>

      <Field label="System Prompt Mode">
        <select
          aria-label="System Prompt Mode"
          value={systemPromptMode}
          onChange={(e) => setAgentDefaults({ systemPromptMode: e.target.value as any })}
          className={inputCls}
        >
          <option value="append">Append (add your instructions)</option>
          <option value="manual">Manual (full control)</option>
        </select>
      </Field>

      {systemPromptMode === 'append' && (
        <div className="space-y-2">
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 italic">
              App-built sections are injected first. Your instructions are appended at the end.
            </p>
          </div>
          <Field label="Your Instructions">
            <textarea
              aria-label="Your Instructions"
              value={agentDefaults.systemPrompt}
              onChange={(e) => setAgentDefaults({ systemPrompt: e.target.value })}
              rows={8}
              className={inputCls}
              placeholder="Additional instructions appended after app-built sections..."
            />
          </Field>
        </div>
      )}

      {systemPromptMode === 'manual' && (
        <div className="space-y-2">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-300/90">
              You are fully responsible for the system prompt. No safety guardrails, tooling, workspace, or runtime metadata will be injected.
            </p>
          </div>
          <Field label="System Prompt">
            <textarea
              aria-label="System Prompt"
              value={agentDefaults.systemPrompt}
              onChange={(e) => setAgentDefaults({ systemPrompt: e.target.value })}
              rows={8}
              className={inputCls}
              placeholder="Your complete system prompt..."
            />
          </Field>
        </div>
      )}

      <Field label="Safety Guardrails" hint="Injected into every agent's system prompt in append mode.">
        <textarea
          aria-label="Safety Guardrails"
          value={agentDefaults.safetyGuardrails}
          onChange={(e) => setAgentDefaults({ safetyGuardrails: e.target.value })}
          rows={8}
          className={inputCls}
        />
      </Field>

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Apply provider, model, and thinking level to all existing agents? This does not change names, descriptions, tags, system prompts, capabilities, or peripheral links.')) {
              applyAgentDefaultsToExistingAgents();
            }
          }}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/15"
        >
          Apply to existing agents
        </button>
      </div>
    </div>
  );
}

// --- Storage sub-section ---

function StorageSubSection() {
  const storageDefaults = useSettingsStore((s) => s.storageDefaults);
  const setStorageDefaults = useSettingsStore((s) => s.setStorageDefaults);
  const applyStorageDefaultsToExistingNodes = useGraphStore((s) => s.applyStorageDefaultsToExistingNodes);

  return (
    <div className="space-y-4">
      <Field label="Storage Path" hint="Root directory for new storage nodes. Supports ~ expansion.">
        <input
          type="text"
          aria-label="Storage Path"
          value={storageDefaults.storagePath}
          onChange={(e) => setStorageDefaults({ storagePath: e.target.value })}
          className={inputCls}
          placeholder="e.g. ~/.simple-agent-manager/storage"
        />
      </Field>

      <Field label="Session Retention" hint="Maximum number of sessions to keep per agent.">
        <input
          type="number"
          aria-label="Session Retention"
          value={storageDefaults.sessionRetention}
          onChange={(e) => setStorageDefaults({ sessionRetention: parseInt(e.target.value) || 50 })}
          min={1}
          className={inputCls}
        />
      </Field>

      <Field label="Memory Enabled">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={storageDefaults.memoryEnabled}
            onChange={(e) => setStorageDefaults({ memoryEnabled: e.target.checked })}
            className="rounded border-slate-600"
          />
          Enable memory persistence for new storage nodes
        </label>
      </Field>

      <Field label="Maintenance Mode">
        <select
          aria-label="Maintenance Mode"
          value={storageDefaults.maintenanceMode}
          onChange={(e) => setStorageDefaults({ maintenanceMode: e.target.value as 'warn' | 'enforce' })}
          className={inputCls}
        >
          <option value="warn">Warn</option>
          <option value="enforce">Enforce</option>
        </select>
      </Field>

      <Field label="Prune After Days" hint="Delete sessions older than this many days during maintenance.">
        <input
          type="number"
          aria-label="Prune After Days"
          value={storageDefaults.pruneAfterDays}
          onChange={(e) => setStorageDefaults({ pruneAfterDays: parseInt(e.target.value) || 30 })}
          min={1}
          className={inputCls}
        />
      </Field>

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Apply the default storage path to all existing storage nodes? This will change where their data is expected to live.')) {
              applyStorageDefaultsToExistingNodes();
            }
          }}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/15"
        >
          Apply to existing storage nodes
        </button>
      </div>
    </div>
  );
}

// --- Context Engine sub-section ---

function ContextEngineSubSection() {
  const defaults = useSettingsStore((s) => s.contextEngineDefaults);
  const setDefaults = useSettingsStore((s) => s.setContextEngineDefaults);

  return (
    <div className="space-y-4">
      <Field label="Token Budget" hint="Maximum context window size in tokens.">
        <input
          type="number"
          aria-label="Token Budget"
          value={defaults.tokenBudget}
          onChange={(e) => setDefaults({ tokenBudget: parseInt(e.target.value) || 128000 })}
          min={1024}
          step={1024}
          className={inputCls}
        />
      </Field>

      <Field label="Reserved for Response" hint="Tokens reserved for model response.">
        <input
          type="number"
          aria-label="Reserved for Response"
          value={defaults.reservedForResponse}
          onChange={(e) => setDefaults({ reservedForResponse: parseInt(e.target.value) || 4096 })}
          min={256}
          step={256}
          className={inputCls}
        />
      </Field>

      <Field label="Compaction Strategy">
        <select
          aria-label="Compaction Strategy"
          value={defaults.compactionStrategy}
          onChange={(e) => setDefaults({ compactionStrategy: e.target.value as CompactionStrategy })}
          className={inputCls}
        >
          {COMPACTION_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>

      <Field label="Compaction Threshold" hint="Fraction of token budget that triggers compaction (0-1).">
        <input
          type="number"
          aria-label="Compaction Threshold"
          value={defaults.compactionThreshold}
          onChange={(e) => setDefaults({ compactionThreshold: parseFloat(e.target.value) || 0.8 })}
          min={0.1}
          max={1}
          step={0.05}
          className={inputCls}
        />
      </Field>

      <Field label="RAG Enabled">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={defaults.ragEnabled}
            onChange={(e) => setDefaults({ ragEnabled: e.target.checked })}
            className="rounded border-slate-600"
          />
          Enable retrieval-augmented generation
        </label>
      </Field>

      {defaults.ragEnabled && (
        <>
          <Field label="RAG Top K" hint="Number of results to retrieve.">
            <input
              type="number"
              aria-label="RAG Top K"
              value={defaults.ragTopK}
              onChange={(e) => setDefaults({ ragTopK: parseInt(e.target.value) || 5 })}
              min={1}
              max={50}
              className={inputCls}
            />
          </Field>

          <Field label="RAG Min Score" hint="Minimum similarity score (0-1).">
            <input
              type="number"
              aria-label="RAG Min Score"
              value={defaults.ragMinScore}
              onChange={(e) => setDefaults({ ragMinScore: parseFloat(e.target.value) || 0.7 })}
              min={0}
              max={1}
              step={0.05}
              className={inputCls}
            />
          </Field>
        </>
      )}
    </div>
  );
}

// --- Memory sub-section ---

function MemorySubSection() {
  const defaults = useSettingsStore((s) => s.memoryDefaults);
  const setDefaults = useSettingsStore((s) => s.setMemoryDefaults);

  return (
    <div className="space-y-4">
      <Field label="Backend">
        <select
          aria-label="Backend"
          value={defaults.backend}
          onChange={(e) => setDefaults({ backend: e.target.value as MemoryBackend })}
          className={inputCls}
        >
          {MEMORY_BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Field>

      <Field label="Max Session Messages" hint="Maximum messages retained in session context.">
        <input
          type="number"
          aria-label="Max Session Messages"
          value={defaults.maxSessionMessages}
          onChange={(e) => setDefaults({ maxSessionMessages: parseInt(e.target.value) || 100 })}
          min={1}
          className={inputCls}
        />
      </Field>

      <Field label="Persist Across Sessions">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={defaults.persistAcrossSessions}
            onChange={(e) => setDefaults({ persistAcrossSessions: e.target.checked })}
            className="rounded border-slate-600"
          />
          Keep memory data between sessions
        </label>
      </Field>

      <Field label="Compaction">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={defaults.compactionEnabled}
            onChange={(e) => setDefaults({ compactionEnabled: e.target.checked })}
            className="rounded border-slate-600"
          />
          Enable memory compaction
        </label>
      </Field>
    </div>
  );
}

// --- Cron sub-section ---

function CronSubSection() {
  const defaults = useSettingsStore((s) => s.cronDefaults);
  const setDefaults = useSettingsStore((s) => s.setCronDefaults);

  return (
    <div className="space-y-4">
      <Field label="Schedule" hint="Cron expression (e.g. '0 9 * * *' for daily at 9 AM).">
        <input
          type="text"
          aria-label="Schedule"
          value={defaults.schedule}
          onChange={(e) => setDefaults({ schedule: e.target.value })}
          className={inputCls}
          placeholder="0 9 * * *"
        />
      </Field>

      <Field label="Session Mode">
        <select
          aria-label="Session Mode"
          value={defaults.sessionMode}
          onChange={(e) => setDefaults({ sessionMode: e.target.value as 'persistent' | 'ephemeral' })}
          className={inputCls}
        >
          <option value="persistent">Persistent</option>
          <option value="ephemeral">Ephemeral</option>
        </select>
      </Field>

      <Field label="Timezone">
        <input
          type="text"
          aria-label="Timezone"
          value={defaults.timezone}
          onChange={(e) => setDefaults({ timezone: e.target.value })}
          className={inputCls}
          placeholder="local"
        />
      </Field>

      <Field label="Max Run Duration (ms)" hint="Maximum time a cron run is allowed to execute.">
        <input
          type="number"
          aria-label="Max Run Duration"
          value={defaults.maxRunDurationMs}
          onChange={(e) => setDefaults({ maxRunDurationMs: parseInt(e.target.value) || 300000 })}
          min={1000}
          step={1000}
          className={inputCls}
        />
      </Field>

      <Field label="Retention Days" hint="How long to keep cron run history.">
        <input
          type="number"
          aria-label="Retention Days"
          value={defaults.retentionDays}
          onChange={(e) => setDefaults({ retentionDays: parseInt(e.target.value) || 7 })}
          min={1}
          className={inputCls}
        />
      </Field>
    </div>
  );
}

// --- Main component with tabs ---

export default function DefaultsSection() {
  const [activeTab, setActiveTab] = useState<DefaultsSubTab>('agent');

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg bg-slate-900/60 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active sub-section */}
      {activeTab === 'agent' && <AgentSubSection />}
      {activeTab === 'storage' && <StorageSubSection />}
      {activeTab === 'contextEngine' && <ContextEngineSubSection />}
      {activeTab === 'memory' && <MemorySubSection />}
      {activeTab === 'cron' && <CronSubSection />}
    </div>
  );
}
