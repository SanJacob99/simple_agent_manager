import { nanoid } from 'nanoid';
import { useGraphStore } from '../../store/graph-store';
import type {
  EvalsNodeData,
  EvalCase,
  EvalAssertion,
  EvalAssertionType,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const ASSERTION_TYPES: { id: EvalAssertionType; label: string }[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Does not contain' },
  { id: 'equals', label: 'Equals' },
  { id: 'regex', label: 'Matches regex' },
  { id: 'llm_judge', label: 'LLM judge (rubric)' },
];

const VALUE_PLACEHOLDER: Record<EvalAssertionType, string> = {
  contains: 'expected substring',
  not_contains: 'forbidden substring',
  equals: 'exact expected text',
  regex: '^\\d{3}-\\d{4}$',
  llm_judge: 'Grade pass if the answer is correct, polite, and cites a source.',
};

interface Props {
  nodeId: string;
  data: EvalsNodeData;
}

export default function EvalsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const setCases = (cases: EvalCase[]) => update(nodeId, { cases });

  const addCase = () => {
    const next: EvalCase = {
      id: `case_${nanoid(8)}`,
      name: `Case ${data.cases.length + 1}`,
      input: '',
      assertions: [],
    };
    setCases([...data.cases, next]);
  };

  const updateCase = (caseId: string, patch: Partial<EvalCase>) => {
    setCases(data.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)));
  };

  const removeCase = (caseId: string) => {
    setCases(data.cases.filter((c) => c.id !== caseId));
  };

  const addAssertion = (caseId: string) => {
    const next: EvalAssertion = {
      id: `assert_${nanoid(8)}`,
      type: 'contains',
      value: '',
    };
    setCases(
      data.cases.map((c) =>
        c.id === caseId ? { ...c, assertions: [...c.assertions, next] } : c,
      ),
    );
  };

  const updateAssertion = (
    caseId: string,
    assertionId: string,
    patch: Partial<EvalAssertion>,
  ) => {
    setCases(
      data.cases.map((c) =>
        c.id === caseId
          ? {
              ...c,
              assertions: c.assertions.map((a) =>
                a.id === assertionId ? { ...a, ...patch } : a,
              ),
            }
          : c,
      ),
    );
  };

  const removeAssertion = (caseId: string, assertionId: string) => {
    setCases(
      data.cases.map((c) =>
        c.id === caseId
          ? { ...c, assertions: c.assertions.filter((a) => a.id !== assertionId) }
          : c,
      ),
    );
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
        tooltip="When off, the suite is wired into the graph but the runner never executes it."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500/30"
          />
          <span className="text-xs text-slate-300">Run with the suite</span>
        </label>
      </Field>

      <Field
        label="Pass threshold"
        tooltip="Fraction (0–1) of a case's assertions that must pass for the case to count as a pass. 1 = every assertion must pass."
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

      <Field
        label="Judge model"
        tooltip="Model used to grade llm_judge assertions. Empty inherits the agent's model."
      >
        <input
          className={inputClass}
          value={data.judgeModelId}
          placeholder="inherit agent model"
          onChange={(e) => update(nodeId, { judgeModelId: e.target.value })}
        />
      </Field>

      <Field
        label="Max concurrency"
        tooltip="Upper bound on cases executed in parallel when the runner is invoked."
      >
        <input
          type="number"
          min={1}
          className={inputClass}
          value={data.maxConcurrency}
          onChange={(e) =>
            update(nodeId, { maxConcurrency: Math.max(1, Number(e.target.value) || 1) })
          }
        />
      </Field>

      <Field label={`Cases (${data.cases.length})`}>
        <div className="space-y-3">
          {data.cases.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-slate-700 bg-slate-850/40 p-2"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  className={inputClass}
                  value={c.name}
                  placeholder="Case name"
                  onChange={(e) => updateCase(c.id, { name: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeCase(c.id)}
                  className="shrink-0 rounded-md px-2 text-xs text-slate-500 transition hover:text-red-400"
                  aria-label={`Remove ${c.name}`}
                >
                  ×
                </button>
              </div>

              <textarea
                className={textareaClass}
                rows={2}
                value={c.input}
                placeholder="Input prompt sent to the agent"
                onChange={(e) => updateCase(c.id, { input: e.target.value })}
              />

              <div className="mt-2 space-y-1.5">
                {c.assertions.map((a) => (
                  <div key={a.id} className="flex items-start gap-1.5">
                    <select
                      className={`${selectClass} max-w-[40%]`}
                      value={a.type}
                      onChange={(e) =>
                        updateAssertion(c.id, a.id, {
                          type: e.target.value as EvalAssertionType,
                        })
                      }
                    >
                      {ASSERTION_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className={inputClass}
                      value={a.value}
                      placeholder={VALUE_PLACEHOLDER[a.type]}
                      onChange={(e) =>
                        updateAssertion(c.id, a.id, { value: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeAssertion(c.id, a.id)}
                      className="shrink-0 rounded-md px-1.5 text-xs text-slate-500 transition hover:text-red-400"
                      aria-label="Remove assertion"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addAssertion(c.id)}
                  className="rounded-md bg-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-600"
                >
                  + Assertion
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addCase}
            className="w-full rounded-md border border-dashed border-slate-700 px-2 py-1.5 text-xs text-slate-400 transition hover:border-teal-500/60 hover:text-teal-300"
          >
            + Add case
          </button>
        </div>
      </Field>
    </div>
  );
}
