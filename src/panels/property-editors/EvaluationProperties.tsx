import { useGraphStore } from '../../store/graph-store';
import type { EvaluationNodeData, EvalCase } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

interface Props {
  nodeId: string;
  data: EvaluationNodeData;
}

function newCaseId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const checkboxClass =
  'rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30';

export default function EvaluationProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const patchCase = (id: string, patch: Partial<EvalCase>) => {
    update(nodeId, {
      cases: data.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const addCase = () => {
    const next: EvalCase = {
      id: newCaseId(),
      name: `Case ${data.cases.length + 1}`,
      input: '',
      expected: '',
      tags: [],
    };
    update(nodeId, { cases: [...data.cases, next] });
  };

  const removeCase = (id: string) => {
    update(nodeId, { cases: data.cases.filter((c) => c.id !== id) });
  };

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field
        label="Enabled"
        tooltip="When off, the suite stays wired into the graph but never runs."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className={checkboxClass}
          />
          <span className="text-xs text-slate-300">Run this suite</span>
        </label>
      </Field>

      <Field
        label="Judge mode"
        tooltip="Heuristic grades with a deterministic substring/exact match. LLM hands the response and rubric to a judge model."
      >
        <select
          className={selectClass}
          value={data.judgeMode}
          onChange={(e) =>
            update(nodeId, { judgeMode: e.target.value as EvaluationNodeData['judgeMode'] })
          }
        >
          <option value="heuristic">Heuristic (match)</option>
          <option value="llm">LLM-as-judge</option>
        </select>
      </Field>

      {data.judgeMode === 'llm' && (
        <>
          <Field
            label="Judge model"
            tooltip="Model id used to grade responses. Empty inherits the agent's model."
          >
            <input
              className={inputClass}
              value={data.judgeModelId}
              onChange={(e) => update(nodeId, { judgeModelId: e.target.value })}
              placeholder="inherit agent model"
            />
          </Field>

          <Field
            label="Judge rubric"
            tooltip="System prompt handed to the judge model. Describe how to grade a response against the expected answer."
          >
            <textarea
              className={textareaClass}
              rows={3}
              value={data.judgePrompt}
              onChange={(e) => update(nodeId, { judgePrompt: e.target.value })}
            />
          </Field>
        </>
      )}

      <Field
        label="Score scale"
        tooltip="Binary marks each case pass/fail. Numeric grades 0-1 and passes when the score meets the threshold."
      >
        <select
          className={selectClass}
          value={data.scoreScale}
          onChange={(e) =>
            update(nodeId, { scoreScale: e.target.value as EvaluationNodeData['scoreScale'] })
          }
        >
          <option value="binary">Binary (pass / fail)</option>
          <option value="numeric">Numeric (0-1 score)</option>
        </select>
      </Field>

      {data.scoreScale === 'numeric' && (
        <Field
          label="Pass threshold"
          tooltip="Minimum score (0-1) for a case to count as passing."
        >
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className={inputClass}
            value={data.passThreshold}
            onChange={(e) =>
              update(nodeId, {
                passThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
              })
            }
          />
        </Field>
      )}

      <Field
        label="Auto-run on save"
        tooltip="Re-run the suite automatically whenever the agent config changes."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.autoRunOnSave}
            onChange={(e) => update(nodeId, { autoRunOnSave: e.target.checked })}
            className={checkboxClass}
          />
          <span className="text-xs text-slate-300">Run after every config change</span>
        </label>
      </Field>

      <Field
        label="Stop after N failures"
        tooltip="Abort the run once this many cases fail. 0 runs every case."
      >
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.maxFailures}
          onChange={(e) =>
            update(nodeId, { maxFailures: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Field>

      <Field label="Per-case timeout (ms)">
        <input
          type="number"
          min={0}
          step={1000}
          className={inputClass}
          value={data.caseTimeoutMs}
          onChange={(e) =>
            update(nodeId, { caseTimeoutMs: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Field>

      <Field label={`Test cases (${data.cases.length})`}>
        <div className="space-y-2">
          {data.cases.map((c) => (
            <div
              key={c.id}
              className="space-y-1.5 rounded-md border border-slate-700 bg-slate-900/40 p-2"
            >
              <div className="flex items-center gap-1.5">
                <input
                  className={inputClass}
                  value={c.name}
                  onChange={(e) => patchCase(c.id, { name: e.target.value })}
                  placeholder="Case name"
                />
                <button
                  type="button"
                  onClick={() => removeCase(c.id)}
                  className="shrink-0 rounded-md bg-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-red-500/20 hover:text-red-400"
                  aria-label={`Remove ${c.name}`}
                >
                  ×
                </button>
              </div>
              <textarea
                className={textareaClass}
                rows={2}
                value={c.input}
                onChange={(e) => patchCase(c.id, { input: e.target.value })}
                placeholder="Input prompt sent to the agent"
              />
              <textarea
                className={textareaClass}
                rows={2}
                value={c.expected}
                onChange={(e) => patchCase(c.id, { expected: e.target.value })}
                placeholder={
                  data.judgeMode === 'llm'
                    ? 'Expected answer / grading notes'
                    : 'Expected substring or exact answer'
                }
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addCase}
            className="w-full rounded-md bg-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600"
          >
            + Add case
          </button>
        </div>
      </Field>
    </div>
  );
}
