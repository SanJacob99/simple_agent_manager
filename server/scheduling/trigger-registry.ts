import type { ResolvedTriggerConfig, TriggerSourceKind } from '../../shared/agent-config';

/**
 * Trigger registry — the event-driven counterpart to the cron scheduler.
 *
 * `cron` covers time. This module covers the other ways modern agents fire:
 * inbound webhooks, filesystem changes, queue messages, and explicit manual
 * runs. Each connected `trigger` node resolves to a `ResolvedTriggerConfig`;
 * this registry decides, for an inbound event, whether that source should fire
 * a headless run — applying the enabled toggle, webhook signature check, and a
 * per-source debounce window — and hands back the prompt to run with.
 *
 * Like the reflection and budget engines, this is the dependency-free substrate
 * the runtime calls: it owns validation and the fire decision, while the
 * runtime owns the actual HTTP mount / fs watcher / queue drain and the call
 * into the `RunCoordinator`. Time is supplied by the caller (`at` on the event)
 * so the class stays deterministic and testable without touching the clock.
 *
 * Wiring the registry into `server/scheduling/` alongside `CronScheduler` (mount
 * webhook receivers, start fs watchers, drain queues, and route each `fire()`
 * result into the same headless-run path the cron scheduler uses) is the
 * remaining integration step; the API below is the stable surface it targets.
 */

/** An inbound event handed to the registry to evaluate against a source. */
export interface TriggerEvent {
  /** Which source this event is aimed at. */
  triggerNodeId: string;
  /** Kind of the arriving event; must match the source's `kind` to fire. */
  kind: TriggerSourceKind;
  /** Epoch ms the event arrived; injected by the caller (the engine is clock-free). */
  at: number;
  /** Arbitrary payload — webhook body, changed path, queue message. Serialized into the run prompt. */
  payload?: unknown;
  /** `webhook`: signature presented by the caller, checked against `webhookSecret`. */
  signature?: string;
}

/** The outcome of evaluating an event against a source. */
export interface TriggerDecision {
  fire: boolean;
  /** Why the source did or did not fire. */
  reason:
    | 'fired'
    | 'disabled'
    | 'kind_mismatch'
    | 'unknown_source'
    | 'debounced'
    | 'bad_signature';
  /** When `fire` is true, the prompt to hand the headless run. */
  runPrompt?: string;
  /** When `fire` is true, whether to reuse a persistent session or spin an ephemeral one. */
  sessionMode?: 'persistent' | 'ephemeral';
}

/**
 * Constant-time-ish shared-secret comparison. Not cryptographic HMAC — the
 * runtime is expected to compute the real signature and pass the plain secret
 * here — but it avoids leaking length via early exit on the common path. An
 * empty configured secret means "accept unsigned requests".
 */
export function verifyWebhookSignature(secret: string, presented: string | undefined): boolean {
  if (!secret) return true;
  if (typeof presented !== 'string' || presented.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) {
    mismatch |= secret.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validate a resolved trigger config, returning a list of human-readable
 * problems (empty when valid). Mirrors the kind of pre-flight the cron
 * scheduler does on a schedule string before registering a job.
 */
export function validateTriggerConfig(config: ResolvedTriggerConfig): string[] {
  const problems: string[] = [];
  if (!config.prompt.trim()) {
    problems.push('prompt is empty; a triggered run has nothing to do');
  }
  if (config.debounceMs < 0) problems.push('debounceMs must be >= 0');
  if (config.maxRunDurationMs < 0) problems.push('maxRunDurationMs must be >= 0');
  switch (config.kind) {
    case 'webhook':
      if (!config.webhookPath.trim()) problems.push('webhook trigger needs a webhookPath');
      else if (!config.webhookPath.startsWith('/')) problems.push('webhookPath must start with "/"');
      break;
    case 'fileWatch':
      if (!config.watchPaths.trim()) problems.push('fileWatch trigger needs at least one watch path');
      if (config.watchEvents.length === 0) problems.push('fileWatch trigger needs at least one watch event');
      break;
    case 'queue':
      if (!config.queueName.trim()) problems.push('queue trigger needs a queueName');
      break;
    case 'manual':
      break;
  }
  return problems;
}

/**
 * Compose the prompt handed to the headless run: the configured prompt with the
 * event payload appended as a fenced block so the agent can see what fired it.
 */
export function buildRunPrompt(config: ResolvedTriggerConfig, event: TriggerEvent): string {
  const base = config.prompt.trim();
  if (event.payload === undefined || event.payload === null) return base;
  let rendered: string;
  if (typeof event.payload === 'string') {
    rendered = event.payload;
  } else {
    try {
      rendered = JSON.stringify(event.payload, null, 2);
    } catch {
      rendered = String(event.payload);
    }
  }
  return `${base}\n\n## Event payload (${config.kind})\n\n\`\`\`\n${rendered}\n\`\`\``;
}

/** Split the comma-separated `watchPaths` field into trimmed, non-empty globs. */
export function parseWatchGlobs(watchPaths: string): string[] {
  return watchPaths
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/**
 * Holds the resolved trigger sources for one agent and decides whether an
 * inbound event should fire. The runtime owns one registry per agent, calls
 * `reconcile()` when the config changes, and routes every inbound event through
 * `fire()`.
 */
export class TriggerRegistry {
  private sources = new Map<string, ResolvedTriggerConfig>();
  private lastFiredAt = new Map<string, number>();

  constructor(triggers: ResolvedTriggerConfig[] = []) {
    this.reconcile(triggers);
  }

  /** Replace the registered sources with the enabled ones from `triggers`. */
  reconcile(triggers: ResolvedTriggerConfig[]): void {
    const next = new Map<string, ResolvedTriggerConfig>();
    for (const t of triggers) {
      if (t.enabled) next.set(t.triggerNodeId, t);
    }
    this.sources = next;
    // Drop debounce state for sources that no longer exist.
    for (const id of [...this.lastFiredAt.keys()]) {
      if (!next.has(id)) this.lastFiredAt.delete(id);
    }
  }

  /** Whether any enabled source is registered. */
  get active(): boolean {
    return this.sources.size > 0;
  }

  /** The enabled sources currently registered. */
  list(): ResolvedTriggerConfig[] {
    return [...this.sources.values()];
  }

  /**
   * Decide whether an inbound event fires its source. Returns a `TriggerDecision`
   * describing the outcome; on `fire`, the caller launches a headless run with
   * `runPrompt`/`sessionMode` and the registry records the fire time for
   * debounce. A disabled/unknown/mismatched/debounced/badly-signed event does
   * not fire and does not update the debounce clock.
   */
  fire(event: TriggerEvent): TriggerDecision {
    const source = this.sources.get(event.triggerNodeId);
    if (!source) return { fire: false, reason: 'unknown_source' };
    if (!source.enabled) return { fire: false, reason: 'disabled' };
    if (source.kind !== event.kind) return { fire: false, reason: 'kind_mismatch' };
    if (source.kind === 'webhook' && !verifyWebhookSignature(source.webhookSecret, event.signature)) {
      return { fire: false, reason: 'bad_signature' };
    }

    if (source.debounceMs > 0) {
      const last = this.lastFiredAt.get(source.triggerNodeId);
      if (last !== undefined && event.at - last < source.debounceMs) {
        return { fire: false, reason: 'debounced' };
      }
    }

    this.lastFiredAt.set(source.triggerNodeId, event.at);
    return {
      fire: true,
      reason: 'fired',
      runPrompt: buildRunPrompt(source, event),
      sessionMode: source.sessionMode,
    };
  }
}
