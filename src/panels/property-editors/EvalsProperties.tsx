import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type { EvalsNodeData, EvalCase, EvalGraderType } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const GRADERS: { id: EvalGraderType; label: string }[] = [
  { id: 'exact_match', label: 'Exact match' },
  { id: 'contains', label: 'Contains' },
  { id: 'regex', label: 'Regex' },
  { id: 'json_schema', label: 'JSON Schema' },
  { id: 'llm_judge', label: 'LLM judge' },
];

interface Props {
  nodeId: string;
  data: EvalsNodeData;
}

export default function EvalsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const updateCase = (index: number, patch: Partial<EvalCase>) => {
    const cases = data.cases.map((c, i) => (i === index ? { ...c, ...patch } : c));
    update(nodeId, { cases });
  };

  const addCase = () => {
    const next: EvalCase = {
      id: nanoid(6),
      input: '',
      expected: '',
      grader: data.defaultGrader,
      weight: 1,
    };
    update(nodeId, { cases: [...data.cases, next] });
  };

  const removeCase = (index: number) => {
    update(nodeId, { cases: data.cases.filter((_, i) => i !== index) });
  };

  const usesJudge =
    data.defaultGrader === 'llm_judge' ||
    data.cases.some((c) => (c.grader ?? data.defaultGrader) === 'llm_judge');

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
        tooltip="When off, the suite is wired into the graph but never executed by the runner."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Run this suite during evaluation</span>
        </label>
      </Field>

      <Field label="Default grader" tooltip="Grader used for cases that don't set their own.">
        <select
          className={selectClass}
          value={data.defaultGrader}
          onChange={(e) => update(nodeId, { defaultGrader: e.target.value as EvalGraderType })}
        >
          {GRADERS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Pass threshold"
        tooltip="Weighted suite score (0–1) at or above which the suite passes."
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
              passThreshold: Math.max(0, Math.min(1, Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Max concurrency"
        tooltip="How many cases the runner executes in parallel."
      >
        <input
          type="number"
          min={1}
          step={1}
          className={inputClass}
          value={data.maxConcurrency}
          onChange={(e) =>
            update(nodeId, { maxConcurrency: Math.max(1, Number(e.target.value) || 1) })
          }
        />
      </Field>

      <Field
        label="Fail on regression"
        tooltip="Flag the run when its score drops below the previously recorded best score."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.failOnRegression}
            onChange={(e) => update(nodeId, { failOnRegression: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Gate on score regression</span>
        </label>
      </Field>

      {usesJudge && (
        <>
          <Field
            label="Judge model"
            tooltip="Model used for llm_judge cases. Empty falls back to the agent's model."
          >
            <input
              className={inputClass}
              value={data.judgeModelId}
              onChange={(e) => update(nodeId, { judgeModelId: e.target.value })}
              placeholder="anthropic/claude-opus-4-8"
            />
          </Field>
          <Field label="Judge rubric" tooltip="Instructions appended to the judge prompt.">
            <textarea
              className={textareaClass}
              rows={3}
              value={data.judgePrompt}
              onChange={(e) => update(nodeId, { judgePrompt: e.target.value })}
            />
          </Field>
        </>
      )}

      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Cases ({data.cases.length})
        </span>
        <button
          onClick={addCase}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          <Plus size={12} /> Add case
        </button>
      </div>

      <div className="space-y-3">
        {data.cases.map((c, i) => (
          <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
              <button
                onClick={() => removeCase(i)}
                className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                title="Remove case"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <textarea
              className={`${textareaClass} mb-2`}
              rows={2}
              placeholder="Input prompt"
              value={c.input}
              onChange={(e) => updateCase(i, { input: e.target.value })}
            />
            <textarea
              className={`${textareaClass} mb-2`}
              rows={2}
              placeholder="Expected (text, regex, or JSON Schema)"
              value={c.expected}
              onChange={(e) => updateCase(i, { expected: e.target.value })}
            />
            <div className="flex gap-2">
              <select
                className={selectClass}
                value={c.grader ?? data.defaultGrader}
                onChange={(e) => updateCase(i, { grader: e.target.value as EvalGraderType })}
              >
                {GRADERS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={1}
                className={`${inputClass} w-20`}
                title="Weight"
                value={c.weight}
                onChange={(e) =>
                  updateCase(i, { weight: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
