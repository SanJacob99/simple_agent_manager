import { appendFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ResolvedTelemetryConfig } from '../../shared/agent-config';

/**
 * Telemetry / observability engine.
 *
 * A telemetry node attached to an agent instruments its runs into OpenTelemetry-
 * style spans: one root span per run, optional child spans per turn and per tool
 * call. Completed run spans are fanned out to every enabled exporter resolved
 * from the graph.
 *
 * This module is intentionally dependency-free (no `@opentelemetry/*` SDK) so it
 * stays inside the "runtime classes must not pull heavy/React deps" convention.
 * The OTLP exporter emits the OTLP/HTTP JSON shape directly. Wiring the recorder
 * into `server/agents/run-coordinator.ts` is the remaining integration step;
 * the recorder API below is the stable surface that wiring should target.
 */

export type SpanKind = 'run' | 'turn' | 'tool';

export interface SpanEvent {
  name: string;
  timeUnixNano: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface Span {
  kind: SpanKind;
  name: string;
  spanId: string;
  parentSpanId: string | null;
  startUnixNano: number;
  endUnixNano: number | null;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  status: 'unset' | 'ok' | 'error';
  children: Span[];
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Per-1M-token USD prices, keyed by `modelId`. Empty entries fall back to 0. */
export type PriceTable = Record<string, { inputPerMTok: number; outputPerMTok: number }>;

let spanCounter = 0;
function nextSpanId(): string {
  spanCounter = (spanCounter + 1) & 0xffffffff;
  // 16 hex chars, matching the OTLP span_id width.
  return (Date.now().toString(16) + spanCounter.toString(16)).padStart(16, '0').slice(-16);
}

function nowUnixNano(): number {
  return Date.now() * 1_000_000;
}

function estimateCostUsd(
  modelId: string,
  usage: TokenUsage,
  prices: PriceTable,
): number {
  const price = prices[modelId];
  if (!price) return 0;
  const input = (usage.promptTokens ?? 0) / 1_000_000 * price.inputPerMTok;
  const output = (usage.completionTokens ?? 0) / 1_000_000 * price.outputPerMTok;
  return Number((input + output).toFixed(6));
}

/**
 * Records spans for a single run against one resolved telemetry config. Created
 * via `createRunRecorder`. The recorder is a no-op when telemetry is disabled or
 * the run falls outside the configured sample rate, so callers can instrument
 * unconditionally.
 */
export class RunRecorder {
  readonly active: boolean;
  private readonly config: ResolvedTelemetryConfig;
  private readonly prices: PriceTable;
  private readonly root: Span | null;
  private openTurn: Span | null = null;

  constructor(
    config: ResolvedTelemetryConfig,
    runName: string,
    prices: PriceTable,
    sampleDecider: () => number = Math.random,
  ) {
    this.config = config;
    this.prices = prices;
    this.active = config.enabled && sampleDecider() < config.sampleRate;
    this.root = this.active
      ? {
          kind: 'run',
          name: runName,
          spanId: nextSpanId(),
          parentSpanId: null,
          startUnixNano: nowUnixNano(),
          endUnixNano: null,
          attributes: { 'service.name': config.serviceName },
          events: [],
          status: 'unset',
          children: [],
        }
      : null;
  }

  startTurn(modelId: string): void {
    if (!this.root) return;
    this.openTurn = {
      kind: 'turn',
      name: `turn:${modelId}`,
      spanId: nextSpanId(),
      parentSpanId: this.root.spanId,
      startUnixNano: nowUnixNano(),
      endUnixNano: null,
      attributes: { 'gen_ai.request.model': modelId },
      events: [],
      status: 'unset',
      children: [],
    };
    this.root.children.push(this.openTurn);
  }

  endTurn(modelId: string, usage: TokenUsage): void {
    const turn = this.openTurn;
    if (!turn) return;
    turn.endUnixNano = nowUnixNano();
    turn.status = 'ok';
    if (this.config.captureLatency) {
      turn.attributes['duration.ms'] =
        (turn.endUnixNano - turn.startUnixNano) / 1_000_000;
    }
    if (this.config.captureTokens) {
      if (usage.promptTokens != null) turn.attributes['gen_ai.usage.input_tokens'] = usage.promptTokens;
      if (usage.completionTokens != null) turn.attributes['gen_ai.usage.output_tokens'] = usage.completionTokens;
    }
    if (this.config.captureCost) {
      turn.attributes['gen_ai.usage.cost_usd'] = estimateCostUsd(modelId, usage, this.prices);
    }
    this.openTurn = null;
  }

  recordToolCall(
    name: string,
    durationMs: number,
    opts: { error?: string; input?: string; output?: string } = {},
  ): void {
    if (!this.root || !this.config.captureToolCalls) return;
    const parent = this.openTurn ?? this.root;
    const end = nowUnixNano();
    const attributes: Record<string, string | number | boolean> = {
      'tool.name': name,
    };
    if (this.config.captureLatency) attributes['duration.ms'] = durationMs;
    if (!this.config.redactContent) {
      if (opts.input != null) attributes['tool.input'] = opts.input;
      if (opts.output != null) attributes['tool.output'] = opts.output;
    }
    if (opts.error) attributes['error.message'] = opts.error;
    parent.children.push({
      kind: 'tool',
      name: `tool:${name}`,
      spanId: nextSpanId(),
      parentSpanId: parent.spanId,
      startUnixNano: end - durationMs * 1_000_000,
      endUnixNano: end,
      attributes,
      events: [],
      status: opts.error ? 'error' : 'ok',
      children: [],
    });
  }

  /** Close the run span and hand it back for export. Null when inactive. */
  finish(status: 'ok' | 'error' = 'ok'): Span | null {
    if (!this.root) return null;
    this.root.endUnixNano = nowUnixNano();
    this.root.status = status;
    if (this.config.captureLatency) {
      this.root.attributes['duration.ms'] =
        (this.root.endUnixNano - this.root.startUnixNano) / 1_000_000;
    }
    return this.root;
  }
}

export function createRunRecorder(
  config: ResolvedTelemetryConfig,
  runName: string,
  prices: PriceTable = {},
): RunRecorder {
  return new RunRecorder(config, runName, prices);
}

/** Sum a span tree's token/cost attributes into a flat run summary. */
export function summarizeSpan(span: Span): {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  const walk = (s: Span) => {
    inputTokens += Number(s.attributes['gen_ai.usage.input_tokens'] ?? 0);
    outputTokens += Number(s.attributes['gen_ai.usage.output_tokens'] ?? 0);
    costUsd += Number(s.attributes['gen_ai.usage.cost_usd'] ?? 0);
    if (s.kind === 'tool') toolCalls += 1;
    s.children.forEach(walk);
  };
  walk(span);
  const durationMs =
    span.endUnixNano != null ? (span.endUnixNano - span.startUnixNano) / 1_000_000 : 0;
  return { durationMs, inputTokens, outputTokens, costUsd: Number(costUsd.toFixed(6)), toolCalls };
}

/** Fan a completed run span out to the exporter named in the config. */
export async function exportSpan(
  config: ResolvedTelemetryConfig,
  span: Span,
  workspacePath: string | null,
): Promise<void> {
  switch (config.exporter) {
    case 'none':
      return;
    case 'console': {
      const s = summarizeSpan(span);
      // eslint-disable-next-line no-console
      console.log(
        `[telemetry] ${span.name} ${s.durationMs.toFixed(0)}ms ` +
          `in=${s.inputTokens} out=${s.outputTokens} ` +
          `cost=$${s.costUsd} tools=${s.toolCalls}`,
      );
      return;
    }
    case 'file': {
      const target = isAbsolute(config.filePath)
        ? config.filePath
        : resolvePath(workspacePath ?? process.cwd(), config.filePath);
      await mkdir(dirname(target), { recursive: true });
      await appendFile(target, JSON.stringify(span) + '\n', 'utf8');
      return;
    }
    case 'otlp': {
      await postOtlp(config, span);
      return;
    }
  }
}

/** Minimal OTLP/HTTP JSON trace payload. Best-effort; failures are swallowed. */
async function postOtlp(config: ResolvedTelemetryConfig, span: Span): Promise<void> {
  const otlpSpans: unknown[] = [];
  const flatten = (s: Span) => {
    otlpSpans.push({
      name: s.name,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId ?? undefined,
      startTimeUnixNano: String(s.startUnixNano),
      endTimeUnixNano: String(s.endUnixNano ?? s.startUnixNano),
      status: { code: s.status === 'error' ? 2 : s.status === 'ok' ? 1 : 0 },
      attributes: Object.entries(s.attributes).map(([key, value]) => ({
        key,
        value: typeof value === 'number'
          ? { doubleValue: value }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: String(value) },
      })),
    });
    s.children.forEach(flatten);
  };
  flatten(span);

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: config.serviceName } },
          ],
        },
        scopeSpans: [{ scope: { name: 'simple-agent-manager' }, spans: otlpSpans }],
      },
    ],
  };

  try {
    await fetch(config.otlpEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...config.otlpHeaders },
      body: JSON.stringify(payload),
    });
  } catch {
    // Telemetry export must never break a run. Drop on failure.
  }
}
