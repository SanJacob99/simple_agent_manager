import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { ObservabilityNodeData, TraceExporter } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: ObservabilityNodeData;
}

const EXPORTERS: { value: TraceExporter; label: string; hint: string }[] = [
  { value: 'none', label: 'None (drop spans)', hint: 'Tracing wired but nothing is exported.' },
  { value: 'console', label: 'Console', hint: 'Log spans to the server console. No dependencies.' },
  { value: 'otlp', label: 'OTLP (collector)', hint: 'OpenTelemetry Protocol over HTTP to a collector endpoint.' },
  { value: 'langfuse', label: 'Langfuse', hint: 'Ship traces to a Langfuse ingestion endpoint.' },
];

const checkboxClass =
  'rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30';

/** Inline "key: value" editor for exporter headers. */
function HeaderList({
  entries,
  onChange,
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const add = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...entries, [k]: newVal });
    setNewKey('');
    setNewVal('');
  };

  const remove = (k: string) => {
    const { [k]: _, ...rest } = entries;
    onChange(rest);
  };

  return (
    <div className="space-y-1">
      {Object.entries(entries).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1 text-xs">
          <span className="font-mono text-slate-400">{k}:</span>
          <span className="flex-1 truncate text-slate-300">{v}</span>
          <button onClick={() => remove(k)} className="text-red-400 hover:text-red-300">
            x
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          className={inputClass}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Authorization"
        />
        <input
          className={inputClass}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="Bearer ..."
        />
        <button
          onClick={add}
          className="shrink-0 rounded-md bg-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function ObservabilityProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const remote = data.exporter === 'otlp' || data.exporter === 'langfuse';

  const toggle = (key: keyof ObservabilityNodeData) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => update(nodeId, { [key]: e.target.checked });

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
        tooltip="When off, the node stays wired into the graph but the runtime emits no spans."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={toggle('enabled')}
            className={checkboxClass}
          />
          <span className="text-xs text-slate-300">Emit traces at runtime</span>
        </label>
      </Field>

      <Field
        label="Exporter"
        tooltip={EXPORTERS.find((x) => x.value === data.exporter)?.hint ?? ''}
      >
        <select
          className={selectClass}
          value={data.exporter}
          onChange={(e) => update(nodeId, { exporter: e.target.value as TraceExporter })}
        >
          {EXPORTERS.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      </Field>

      {remote && (
        <>
          <Field
            label="Endpoint"
            tooltip="Full URL of the collector or Langfuse host. Empty falls back to the exporter default or env var."
          >
            <input
              className={inputClass}
              value={data.endpoint}
              onChange={(e) => update(nodeId, { endpoint: e.target.value })}
              placeholder="https://otlp.example.com/v1/traces"
            />
          </Field>

          <Field
            label="Headers"
            tooltip="Extra HTTP headers sent with each export batch (auth keys, project ids)."
          >
            <HeaderList
              entries={data.headers}
              onChange={(next) => update(nodeId, { headers: next })}
            />
          </Field>
        </>
      )}

      <Field
        label="Service name"
        tooltip="The service.name resource attribute attached to every span."
      >
        <input
          className={inputClass}
          value={data.serviceName}
          onChange={(e) => update(nodeId, { serviceName: e.target.value })}
          placeholder="simple-agent-manager"
        />
      </Field>

      <Field
        label="Sample rate"
        tooltip="Fraction of runs traced, 0 to 1. 1 traces every run; 0.1 traces one in ten."
      >
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className={inputClass}
          value={data.sampleRate}
          onChange={(e) =>
            update(nodeId, {
              sampleRate: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
            })
          }
        />
      </Field>

      <Field label="Capture">
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.capturePrompts}
              onChange={toggle('capturePrompts')}
              className={checkboxClass}
            />
            <span className="text-xs text-slate-300">Prompts</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.captureCompletions}
              onChange={toggle('captureCompletions')}
              className={checkboxClass}
            />
            <span className="text-xs text-slate-300">Completions</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.captureToolIO}
              onChange={toggle('captureToolIO')}
              className={checkboxClass}
            />
            <span className="text-xs text-slate-300">Tool arguments &amp; results</span>
          </label>
        </div>
      </Field>

      <Field
        label="Privacy &amp; cost"
        tooltip="Redaction strips emails, SSNs, and card-shaped numbers from captured text before export. Cost tracking records token usage and an estimated cost per run."
      >
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.redactPii}
              onChange={toggle('redactPii')}
              className={checkboxClass}
            />
            <span className="text-xs text-slate-300">Redact PII before export</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.trackCost}
              onChange={toggle('trackCost')}
              className={checkboxClass}
            />
            <span className="text-xs text-slate-300">Track token usage &amp; cost</span>
          </label>
        </div>
      </Field>

      <Field
        label="Latency warning (ms)"
        tooltip="Emit a latency.warn span event when a turn takes longer than this. 0 disables the check."
      >
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.latencyWarnMs}
          onChange={(e) =>
            update(nodeId, { latencyWarnMs: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Field>
    </div>
  );
}
