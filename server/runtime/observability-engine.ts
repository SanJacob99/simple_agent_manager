import type {
  ResolvedObservabilityConfig,
  ResolvedEvaluatorConfig,
} from '../../shared/agent-config';

/**
 * Observability & Evals engine — SCAFFOLD.
 *
 * Tracks where production agent tooling converged in 2026: OpenTelemetry-native
 * tracing (OpenInference span conventions) plus lightweight run-time evals
 * (LLM-as-judge and heuristic checks).
 *
 * This is intentionally a self-contained no-op-by-default skeleton. It does NOT
 * pull in the OpenTelemetry SDK yet, and the run coordinator does not invoke it.
 * It establishes the shape the coordinator will call into once tracing/eval
 * wiring lands, mirroring how `connectors`/`mcp`/`vectorDatabase` started as
 * extension surfaces ahead of full product wiring.
 *
 * Wiring plan (see docs/proposals/2026-06-19-feature-roadmap.md, item 1):
 *   1. run-coordinator constructs one engine per run from `config.observability`.
 *   2. On each lifecycle event (llm start/end, tool start/end, handoff) it calls
 *      `recordSpan(...)`; the engine batches and exports via the chosen exporter.
 *   3. After each turn / at session end it calls `runEvaluators(...)` and emits
 *      the returned scores as `eval:score` stream events.
 */

/** OpenInference-style span kinds. */
export type SpanKind = 'llm' | 'tool' | 'agent' | 'chain';

export interface SpanInput {
  kind: SpanKind;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  /** Arbitrary, JSON-serializable attributes (token counts, model id, etc.). */
  attributes?: Record<string, unknown>;
  /** True when the span represents a failed operation. */
  error?: boolean;
}

export interface EvalScore {
  evaluatorId: string;
  name: string;
  scope: ResolvedEvaluatorConfig['scope'];
  /** Score in [0,1]. */
  score: number;
  passed: boolean;
  /** Human-readable reason (judge rationale or heuristic detail). */
  detail: string;
}

/** Context passed to evaluators for a single turn or whole session. */
export interface EvalContext {
  userText: string;
  assistantText: string;
  toolErrors: number;
  turnLatencyMs: number;
  /** Latency budget for the `max-latency` heuristic, in ms. */
  latencyBudgetMs?: number;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;

/** Strip the same PII categories the guardrails engine recognizes. */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(SSN_RE, '[redacted-ssn]')
    .replace(CC_RE, '[redacted-cc]');
}

export class ObservabilityEngine {
  private readonly config: ResolvedObservabilityConfig | null;
  private readonly spans: SpanInput[] = [];

  constructor(config: ResolvedObservabilityConfig | null | undefined) {
    this.config = config ?? null;
  }

  /** True when the node is present, enabled, and tracing is on. */
  get tracingActive(): boolean {
    return !!this.config?.enabled && this.config.tracingEnabled;
  }

  /** True when the node is present, enabled, and at least one evaluator is on. */
  get evalsActive(): boolean {
    return (
      !!this.config?.enabled &&
      this.config.evalsEnabled &&
      this.config.evaluators.some((e) => e.enabled)
    );
  }

  /** Resolved service.name (falls back to the provided default). */
  serviceName(fallback: string): string {
    return this.config?.serviceName?.trim() || fallback;
  }

  /**
   * Record a span. Honors the head-sampling ratio and PII redaction. Today this
   * only buffers in memory; `flush()` is where an exporter will eventually run.
   */
  recordSpan(span: SpanInput): void {
    if (!this.tracingActive) return;
    if (!this.sampled()) return;
    this.spans.push(this.config?.redactPii ? this.redactSpan(span) : span);
  }

  /** Snapshot of buffered spans (used by tests until an exporter is wired). */
  get bufferedSpans(): readonly SpanInput[] {
    return this.spans;
  }

  /**
   * Export buffered spans via the configured exporter, then clear the buffer.
   * `console` is implemented; `otlp-http` is a TODO placeholder; `none` keeps
   * spans in-memory (the buffer is still cleared to bound memory).
   */
  async flush(): Promise<void> {
    if (!this.tracingActive || this.spans.length === 0) return;
    switch (this.config?.exporter) {
      case 'console':
        for (const s of this.spans) {
          // eslint-disable-next-line no-console
          console.log(
            `[otel] ${s.kind} "${s.name}" ${s.endTimeMs - s.startTimeMs}ms${s.error ? ' ERROR' : ''}`,
          );
        }
        break;
      case 'otlp-http':
        // TODO: POST an OTLP/HTTP traces payload to `config.otlpEndpoint` with
        // `config.otlpHeaders`. Deferred until the OTel SDK dependency lands.
        break;
      case 'none':
      default:
        break;
    }
    this.spans.length = 0;
  }

  /**
   * Run the configured evaluators for the given scope against the context.
   * Heuristics are implemented inline; `llm-judge` is a TODO placeholder that
   * currently returns a neutral, non-passing score so callers can wire the
   * event path without a model round-trip.
   */
  runEvaluators(
    scope: ResolvedEvaluatorConfig['scope'],
    ctx: EvalContext,
  ): EvalScore[] {
    if (!this.evalsActive || !this.config) return [];
    const scores: EvalScore[] = [];
    for (const ev of this.config.evaluators) {
      if (!ev.enabled || ev.scope !== scope) continue;
      scores.push(this.scoreOne(ev, ctx));
    }
    return scores;
  }

  // --- internals ---

  private scoreOne(ev: ResolvedEvaluatorConfig, ctx: EvalContext): EvalScore {
    let score = 0;
    let detail = '';
    if (ev.kind === 'heuristic') {
      switch (ev.heuristic) {
        case 'non-empty':
          score = ctx.assistantText.trim().length > 0 ? 1 : 0;
          detail = `assistant text length=${ctx.assistantText.trim().length}`;
          break;
        case 'no-tool-errors':
          score = ctx.toolErrors === 0 ? 1 : 0;
          detail = `toolErrors=${ctx.toolErrors}`;
          break;
        case 'max-latency': {
          const budget = ctx.latencyBudgetMs ?? 30_000;
          score = ctx.turnLatencyMs <= budget ? 1 : 0;
          detail = `latency=${ctx.turnLatencyMs}ms budget=${budget}ms`;
          break;
        }
      }
    } else {
      // TODO: call `ev.judgeModelId` (or the agent model) with `ev.rubric`.
      detail = 'llm-judge not yet wired; returning neutral score';
    }
    return {
      evaluatorId: ev.id,
      name: ev.name,
      scope: ev.scope,
      score,
      passed: score >= ev.passThreshold,
      detail,
    };
  }

  private sampled(): boolean {
    const ratio = this.config?.sampleRatio ?? 1;
    if (ratio >= 1) return true;
    if (ratio <= 0) return false;
    return Math.random() < ratio;
  }

  private redactSpan(span: SpanInput): SpanInput {
    if (!span.attributes) return span;
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(span.attributes)) {
      attributes[k] = typeof v === 'string' ? redactPii(v) : v;
    }
    return { ...span, attributes };
  }
}
