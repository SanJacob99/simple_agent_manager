import { useGraphStore } from '../../store/graph-store';
import type {
  ObservabilityNodeData,
  EvaluatorDefinition,
  EvaluatorKind,
  EvaluatorScope,
  HeuristicCheck,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const HEURISTICS: { id: HeuristicCheck; label: string }[] = [
  { id: 'non-empty', label: 'Response is non-empty' },
  { id: 'no-tool-errors', label: 'No tool call errors' },
  { id: 'max-latency', label: 'Turn under latency budget' },
];

function newEvaluator(): EvaluatorDefinition {
  return {
    id: `eval_${Math.random().toString(36).slice(2, 10)}`,
    name: 'New evaluator',
    kind: 'heuristic',
    scope: 'turn',
    rubric: '',
    judgeModelId: '',
    heuristic: 'non-empty',
    passThreshold: 0.5,
    enabled: true,
  };
}

interface Props {
  nodeId: string;
  data: ObservabilityNodeData;
}

export default function ObservabilityProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  const patchEvaluator = (id: string, patch: Partial<EvaluatorDefinition>) => {
    update(nodeId, {
      evaluators: data.evaluators.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const addEvaluator = () => {
    update(nodeId, { evaluators: [...data.evaluators, newEvaluator()] });
  };

  const removeEvaluator = (id: string) => {
    update(nodeId, { evaluators: data.evaluators.filter((e) => e.id !== id) });
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
        tooltip="Master switch. When off, the node is wired into the graph but the runtime emits no spans and runs no evaluators."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Active at runtime</span>
        </label>
      </Field>

      {/* --- Tracing --- */}
      <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Tracing
      </div>

      <Field
        label="Capture spans"
        tooltip="Emit an OpenTelemetry span (OpenInference conventions) for each LLM call, tool call, and handoff in a run."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.tracingEnabled}
            onChange={(e) => update(nodeId, { tracingEnabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Trace runs</span>
        </label>
      </Field>

      <Field
        label="Exporter"
        tooltip="Where spans are sent. console prints to the server log; otlp-http posts to an OpenTelemetry collector; none keeps spans in-memory for evals only."
      >
        <select
          className={selectClass}
          value={data.exporter}
          onChange={(e) =>
            update(nodeId, { exporter: e.target.value as ObservabilityNodeData['exporter'] })
          }
        >
          <option value="none">None (in-memory)</option>
          <option value="console">Console</option>
          <option value="otlp-http">OTLP / HTTP</option>
        </select>
      </Field>

      {data.exporter === 'otlp-http' && (
        <Field
          label="OTLP endpoint"
          tooltip="Full traces endpoint, e.g. http://localhost:4318/v1/traces"
        >
          <input
            className={inputClass}
            value={data.otlpEndpoint}
            onChange={(e) => update(nodeId, { otlpEndpoint: e.target.value })}
            placeholder="http://localhost:4318/v1/traces"
          />
        </Field>
      )}

      <Field
        label="Service name"
        tooltip="service.name resource attribute. Empty inherits the agent name."
      >
        <input
          className={inputClass}
          value={data.serviceName}
          onChange={(e) => update(nodeId, { serviceName: e.target.value })}
          placeholder="(agent name)"
        />
      </Field>

      <Field
        label="Sampling ratio"
        tooltip="Head sampling in [0,1]. 1 captures every run; 0.1 captures roughly 10%."
      >
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className={inputClass}
          value={data.sampleRatio}
          onChange={(e) =>
            update(nodeId, {
              sampleRatio: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field
        label="Redact PII"
        tooltip="Strip emails, SSNs, and credit-card-shaped numbers from span payloads before export."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.redactPii}
            onChange={(e) => update(nodeId, { redactPii: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Scrub before export</span>
        </label>
      </Field>

      {/* --- Evals --- */}
      <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Evals
      </div>

      <Field
        label="Run evaluators"
        tooltip="Score turns/sessions with LLM-as-judge rubrics or heuristic checks. Results emit as eval:score events."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.evalsEnabled}
            onChange={(e) => update(nodeId, { evalsEnabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Score runs</span>
        </label>
      </Field>

      {data.evalsEnabled && (
        <div className="space-y-2">
          {data.evaluators.map((ev) => (
            <div
              key={ev.id}
              className="rounded-md border border-slate-700 bg-slate-800/50 p-2"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  className={inputClass}
                  value={ev.name}
                  onChange={(e) => patchEvaluator(ev.id, { name: e.target.value })}
                  placeholder="Evaluator name"
                />
                <button
                  type="button"
                  onClick={() => removeEvaluator(ev.id)}
                  className="shrink-0 text-slate-500 hover:text-red-400"
                  aria-label={`Remove ${ev.name}`}
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  className={selectClass}
                  value={ev.kind}
                  onChange={(e) =>
                    patchEvaluator(ev.id, { kind: e.target.value as EvaluatorKind })
                  }
                >
                  <option value="heuristic">Heuristic</option>
                  <option value="llm-judge">LLM judge</option>
                </select>
                <select
                  className={selectClass}
                  value={ev.scope}
                  onChange={(e) =>
                    patchEvaluator(ev.id, { scope: e.target.value as EvaluatorScope })
                  }
                >
                  <option value="turn">Per turn</option>
                  <option value="session">Per session</option>
                </select>
              </div>

              {ev.kind === 'heuristic' ? (
                <select
                  className={`${selectClass} mt-1.5`}
                  value={ev.heuristic}
                  onChange={(e) =>
                    patchEvaluator(ev.id, { heuristic: e.target.value as HeuristicCheck })
                  }
                >
                  {HEURISTICS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <textarea
                    className={`${textareaClass} mt-1.5`}
                    rows={2}
                    value={ev.rubric}
                    onChange={(e) => patchEvaluator(ev.id, { rubric: e.target.value })}
                    placeholder="Rate 0-1 how well the reply answered the user's question."
                  />
                  <input
                    className={`${inputClass} mt-1.5`}
                    value={ev.judgeModelId}
                    onChange={(e) => patchEvaluator(ev.id, { judgeModelId: e.target.value })}
                    placeholder="Judge model (empty = agent model)"
                  />
                </>
              )}

              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Pass ≥
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className={inputClass}
                  value={ev.passThreshold}
                  onChange={(e) =>
                    patchEvaluator(ev.id, {
                      passThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addEvaluator}
            className="w-full rounded-md bg-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600"
          >
            + Add evaluator
          </button>
        </div>
      )}
    </div>
  );
}
