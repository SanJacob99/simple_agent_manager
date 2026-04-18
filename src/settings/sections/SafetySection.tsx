import { useState } from 'react';
import { ShieldAlert, AlertTriangle, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../settings-store';
import { DEFAULT_CONFIRMATION_POLICY } from '../types';

export default function SafetySection() {
  const safety = useSettingsStore((s) => s.safety);
  const setSafetySettings = useSettingsStore((s) => s.setSafetySettings);
  const [localPolicy, setLocalPolicy] = useState(safety.confirmationPolicy);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);

  const policyDirty = localPolicy !== safety.confirmationPolicy;

  const toggleAllowDisable = (next: boolean) => {
    if (next && !showDangerConfirm) {
      setShowDangerConfirm(true);
      return;
    }
    setShowDangerConfirm(false);
    setSafetySettings({ allowDisableHitl: next });
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <header className="mb-4 flex items-start gap-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-slate-100">Human-in-the-Loop</h3>
            <p className="mt-1 text-sm text-slate-400">
              Every new agent ships with <span className="font-mono text-slate-300">ask_user</span> and
              {' '}<span className="font-mono text-slate-300">confirm_action</span> enabled. They pause the run
              and wait for the human before destructive or ambiguous steps. These two tools are locked on in
              the Tools node unless you explicitly unlock them below.
            </p>
          </div>
        </header>

        <div className="space-y-5">
          <div className={`rounded-md border ${safety.allowDisableHitl ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700/50 bg-slate-800/30'} p-3`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={safety.allowDisableHitl}
                onChange={(e) => toggleAllowDisable(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                  Dangerous Fully Auto
                  {safety.allowDisableHitl && (
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-red-300">
                      active
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-slate-400 leading-relaxed">
                  When enabled, the HITL checkboxes in the Tools node become unlocked. You can then uncheck
                  <span className="font-mono text-slate-300"> ask_user </span>
                  and
                  <span className="font-mono text-slate-300"> confirm_action </span>
                  per agent. Any agent with that done can execute destructive shell commands, overwrite
                  files, or hit the network without asking you first.
                </span>
                <span className="mt-2 block text-[11px] text-amber-300/80">
                  Only turn this on for agents whose tools cannot damage your system or reach sensitive
                  networks — e.g. an agent with only <span className="font-mono">calculator</span> or
                  {' '}<span className="font-mono">web_search</span> is safe; one with
                  {' '}<span className="font-mono">exec</span>, <span className="font-mono">write_file</span>,
                  or <span className="font-mono">apply_patch</span> is NOT.
                </span>
              </span>
            </label>

            {showDangerConfirm && !safety.allowDisableHitl && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5">
                <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-xs text-slate-200 leading-snug">
                  <p className="font-semibold text-red-300">You're about to remove the human-oversight guardrail.</p>
                  <p className="mt-1 text-slate-400">
                    If any connected agent has shell, filesystem, or network tools, it will be able to act
                    without asking you. Proceed?
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDangerConfirm(false);
                        setSafetySettings({ allowDisableHitl: true });
                      }}
                      className="rounded-md bg-red-500/20 border border-red-500/40 px-3 py-1 text-xs text-red-200 transition hover:bg-red-500/30"
                    >
                      I understand, enable
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDangerConfirm(false)}
                      className="rounded-md bg-slate-800 border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-slate-200">Confirmation policy</span>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Appended to every agent's system prompt when a HITL tool is enabled.
                  Teaches the model <em>when</em> to call <span className="font-mono">confirm_action</span>,
                  and enforces the "one-tool-call-per-confirm-turn" rule across providers that support
                  parallel tool calls.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocalPolicy(DEFAULT_CONFIRMATION_POLICY);
                  setSafetySettings({ confirmationPolicy: DEFAULT_CONFIRMATION_POLICY });
                }}
                className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                title="Reset to default policy"
              >
                <RotateCcw size={10} /> Reset
              </button>
            </div>
            <textarea
              className="w-full min-h-[220px] rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-200 leading-snug resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-600 focus:outline-none"
              value={localPolicy}
              onChange={(e) => setLocalPolicy(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={!policyDirty}
                onClick={() => setSafetySettings({ confirmationPolicy: localPolicy })}
                className={`rounded-md px-3 py-1.5 text-xs transition ${
                  policyDirty
                    ? 'bg-blue-500/20 border border-blue-500/40 text-blue-200 hover:bg-blue-500/30'
                    : 'bg-slate-800 border border-slate-700 text-slate-600 cursor-not-allowed'
                }`}
              >
                Save policy
              </button>
              {policyDirty && (
                <span className="text-[10px] text-amber-400/80">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
