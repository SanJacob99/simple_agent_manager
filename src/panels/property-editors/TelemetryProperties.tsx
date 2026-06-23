import { useGraphStore } from '../../store/graph-store';
import type { TelemetryNodeData, TelemetryExporter } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

const EXPORTERS: { id: TelemetryExporter; label: string }[] = [
  { id: 'none', label: 'None (in-memory only)' },
  { id: 'console', label: 'Console (server log)' },
  { id: 'file', label: 'File (JSONL)' },
  { id: 'otlp', label: 'OTLP/HTTP collector' },
];

const CAPTURE_TOGGLES: {
  key: keyof Pick<
    TelemetryNodeData,
    'captureTokens' | 'captureCost' | 'captureLatency' | 'captureToolCalls'
  >;
  label: string;
}[] = [
  { key: 'captureTokens', label: 'Token usage' },
  { key: 'captureCost', label: 'Cost estimate' },
  { key: 'captureLatency', label: 'Latency' },
  { key: 'captureToolCalls', label: 'Tool-call spans' },
];

interface Props {
  nodeId: string;
  data: TelemetryNodeData;
}

export default function TelemetryProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

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
        tooltip="When off, the node is wired into the graph but the runtime emits no spans."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Instrument runs</span>
        </label>
      </Field>

      <Field
        label="Capture"
        tooltip="Which signals are recorded on each run span. Disabling a signal keeps spans smaller and cheaper to export."
      >
        <div className="space-y-1">
          {CAPTURE_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data[t.key]}
                onChange={(e) => update(nodeId, { [t.key]: e.target.checked })}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-xs text-slate-300">{t.label}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Exporter"
        tooltip="Where completed spans are sent. OTLP targets any OpenTelemetry collector."
      >
        <select
          className={selectClass}
          value={data.exporter}
          onChange={(e) =>
            update(nodeId, { exporter: e.target.value as TelemetryExporter })
          }
        >
          {EXPORTERS.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
        </select>
      </Field>

      {data.exporter === 'otlp' && (
        <Field
          label="OTLP endpoint"
          tooltip="Full URL of the collector's traces endpoint."
        >
          <input
            className={inputClass}
            value={data.otlpEndpoint}
            onChange={(e) => update(nodeId, { otlpEndpoint: e.target.value })}
            placeholder="http://localhost:4318/v1/traces"
          />
        </Field>
      )}

      {data.exporter === 'file' && (
        <Field
          label="File path"
          tooltip="Newline-delimited JSON spans are appended here. Relative paths resolve to the workspace."
        >
          <input
            className={inputClass}
            value={data.filePath}
            onChange={(e) => update(nodeId, { filePath: e.target.value })}
            placeholder=".sam/telemetry.jsonl"
          />
        </Field>
      )}

      <Field label="Service name" tooltip="The service.name resource attribute on every span.">
        <input
          className={inputClass}
          value={data.serviceName}
          onChange={(e) => update(nodeId, { serviceName: e.target.value })}
          placeholder="simple-agent-manager"
        />
      </Field>

      <Field
        label="Sample rate"
        tooltip="Fraction of runs to record, 0–1. Lower this on high-traffic agents to cut export volume."
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

      <Field
        label="Redact content"
        tooltip="Strip prompt/response text from spans, keeping only counts and metadata. Use when shipping spans off-box."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.redactContent}
            onChange={(e) => update(nodeId, { redactContent: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-300">Omit message content from spans</span>
        </label>
      </Field>
    </div>
  );
}
