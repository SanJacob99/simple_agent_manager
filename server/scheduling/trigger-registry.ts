import type {
  ResolvedTriggerConfig,
  TriggerSource,
} from '../../shared/agent-config';

/**
 * Trigger registry — the event-driven counterpart of the cron scheduler.
 *
 * Where `CronScheduler` fires a run on a time schedule, a `trigger` node fires a
 * run on an external event: an inbound webhook, a filesystem change, a queue
 * message, or delivered email. This module is the dependency-free substrate the
 * runtime calls; it owns event → prompt rendering, the filter grammar, the
 * file-glob matcher, per-trigger admission (debounce + concurrency), and config
 * validation, while the runtime owns the actual transports (the HTTP listener,
 * the fs watcher, the queue consumer) and the headless-run dispatch.
 *
 * The orchestration a `TriggerListener` would perform:
 *
 *   1. A transport receives a raw event and packs it into a `TriggerEvent`.
 *   2. `gate.admit(config, event, now)` decides whether this event should start
 *      a run — applying enabled/validation/filter/debounce/concurrency in order
 *      — and, when it should, returns the rendered prompt.
 *   3. On `{ action: 'run' }` the listener dispatches the prompt down the same
 *      headless-run path the cron scheduler uses, then calls `gate.complete(id)`
 *      when the run settles so the concurrency slot is released.
 *
 * Wiring this into `server/agents/run-coordinator.ts` (mount the webhook routes,
 * start the watchers/consumers, dispatch admitted events, verify webhook HMAC
 * signatures) is the remaining integration step; the API below is the stable
 * surface that wiring targets.
 */

/** A normalized inbound event handed to the registry by a transport. */
export interface TriggerEvent {
  /** Which source produced the event; used to sanity-check against the trigger. */
  source: TriggerSource;
  /** The event body. Filter expressions and `{{event.*}}` substitution read from here. */
  payload: Record<string, unknown>;
  /** For `fileWatch`, the changed path (checked against `watchEvents` + `watchGlob`). */
  path?: string;
  /** For `fileWatch`, the filesystem event kind. */
  fileEvent?: 'create' | 'modify' | 'delete';
}

// --- Prompt rendering -------------------------------------------------------

/**
 * Render a trigger's `prompt` template against an event. `{{event}}` expands to
 * the whole payload as pretty JSON; `{{event.a.b}}` expands to a single nested
 * field (empty string when absent). Unknown placeholders are left untouched so a
 * literal `{{...}}` in the prompt survives. Templates with no placeholders and
 * an empty payload just return the prompt verbatim.
 */
export function renderPrompt(config: ResolvedTriggerConfig, event: TriggerEvent): string {
  return config.prompt.replace(/\{\{\s*(event(?:\.[\w]+)*)\s*\}\}/g, (whole, expr: string) => {
    const path = expr.split('.').slice(1); // drop leading "event"
    if (path.length === 0) {
      return Object.keys(event.payload).length === 0
        ? ''
        : JSON.stringify(event.payload, null, 2);
    }
    const value = resolvePath(event.payload, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** Walk a dotted path into a payload, returning `undefined` on any miss. */
function resolvePath(payload: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// --- Filter grammar ---------------------------------------------------------

export interface FilterResult {
  matched: boolean;
  /**
   * Why the filter decided as it did. `empty` = no filter set (always matches);
   * `parse_error` = the expression could not be understood (fails closed to a
   * non-match) with details in `error`.
   */
  reason: 'empty' | 'matched' | 'no_match' | 'parse_error';
  error?: string;
}

/**
 * Evaluate a trigger's `filter` against an event. Deliberately NOT `eval` — a
 * tiny, safe grammar covering the common cases:
 *
 *   - `event.action == "opened"`   (equality, quoted string / number / bool / null)
 *   - `event.count != 0`           (inequality)
 *   - `event.merged`               (bare truthiness of a field)
 *
 * An empty filter always matches. Anything that does not parse fails closed
 * (matched: false) rather than firing on an event it cannot reason about.
 */
export function evaluateFilter(filter: string, event: TriggerEvent): FilterResult {
  const expr = filter.trim();
  if (expr === '') return { matched: true, reason: 'empty' };

  const cmp = /^(event(?:\.[\w]+)*)\s*(==|!=)\s*(.+)$/.exec(expr);
  if (cmp) {
    const lhs = resolvePath(event.payload, cmp[1].split('.').slice(1));
    const rhs = parseLiteral(cmp[3].trim());
    if ('error' in rhs) return { matched: false, reason: 'parse_error', error: rhs.error };
    const equal = literalEquals(lhs, rhs.value);
    const matched = cmp[2] === '==' ? equal : !equal;
    return { matched, reason: matched ? 'matched' : 'no_match' };
  }

  const bare = /^event(?:\.[\w]+)*$/.exec(expr);
  if (bare) {
    const value = expr === 'event'
      ? Object.keys(event.payload).length > 0
      : resolvePath(event.payload, expr.split('.').slice(1));
    const matched = Boolean(value);
    return { matched, reason: matched ? 'matched' : 'no_match' };
  }

  return {
    matched: false,
    reason: 'parse_error',
    error: `unsupported filter expression: ${expr}`,
  };
}

type Literal = string | number | boolean | null;

function parseLiteral(raw: string): { value: Literal } | { error: string } {
  const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
  if (quoted) return { value: quoted[1] };
  if (raw === 'true') return { value: true };
  if (raw === 'false') return { value: false };
  if (raw === 'null') return { value: null };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { value: Number(raw) };
  // Bare word: treat as an unquoted string literal.
  if (/^[\w-]+$/.test(raw)) return { value: raw };
  return { error: `unparseable literal: ${raw}` };
}

function literalEquals(actual: unknown, lit: Literal): boolean {
  if (lit === null) return actual === null || actual === undefined;
  if (typeof lit === 'boolean') return Boolean(actual) === lit;
  return String(actual) === String(lit);
}

// --- File-watch glob matching ----------------------------------------------

/**
 * Whether a `fileWatch` trigger should react to a change: the fs event kind must
 * be in `watchEvents` and the changed path must match `watchGlob` (empty glob
 * matches everything). `*` matches within a path segment, `**` across segments,
 * `?` a single non-slash char.
 */
export function matchesFileEvent(config: ResolvedTriggerConfig, event: TriggerEvent): boolean {
  if (event.fileEvent && !config.watchEvents.includes(event.fileEvent)) return false;
  if (!config.watchGlob.trim()) return true;
  if (!event.path) return false;
  return globToRegExp(config.watchGlob.trim()).test(event.path);
}

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// --- Validation -------------------------------------------------------------

/**
 * Return the human-readable problems that would stop a trigger from firing
 * usefully. Empty array means the config is coherent. The node UI and the
 * listener both call this so a misconfigured trigger surfaces before it silently
 * never fires.
 */
export function validateTrigger(config: ResolvedTriggerConfig): string[] {
  const problems: string[] = [];
  if (!config.prompt.trim()) problems.push('prompt is empty; a trigger with no prompt starts an empty run');
  if (config.maxConcurrent < 1) problems.push('maxConcurrent must be at least 1');
  if (config.debounceMs < 0) problems.push('debounceMs cannot be negative');

  switch (config.source) {
    case 'webhook':
      if (!config.webhookPath.trim()) problems.push('webhook source needs a webhookPath');
      else if (!config.webhookPath.startsWith('/')) problems.push('webhookPath must start with "/"');
      break;
    case 'fileWatch':
      if (!config.watchPath.trim()) problems.push('fileWatch source needs a watchPath');
      if (config.watchEvents.length === 0) problems.push('fileWatch source needs at least one watched event');
      break;
    case 'queue':
      if (!config.queueTarget.trim()) problems.push('queue source needs a queueTarget');
      break;
    case 'emailInbound':
      if (!config.emailAddress.trim()) problems.push('emailInbound source needs an emailAddress');
      break;
    case 'manual':
      break;
  }
  return problems;
}

/** Whether inbound webhook requests must carry a valid HMAC signature. */
export function webhookAuthRequired(config: ResolvedTriggerConfig): boolean {
  return config.source === 'webhook' && config.webhookSecretEnvVar.trim() !== '';
}

/** One-line human summary of what a trigger listens for, for logs and the node UI. */
export function describeTrigger(config: ResolvedTriggerConfig): string {
  switch (config.source) {
    case 'webhook':
      return `${config.webhookMethod} ${config.webhookPath || '(no path)'}${
        webhookAuthRequired(config) ? ' (signed)' : ''
      }`;
    case 'fileWatch':
      return `watch ${config.watchPath || '(no path)'}${
        config.watchGlob ? `/${config.watchGlob}` : ''
      } [${config.watchEvents.join(', ')}]`;
    case 'queue':
      return `queue ${config.queueTarget || '(no target)'}`;
    case 'emailInbound':
      return `email ${config.emailAddress || '(no address)'}`;
    case 'manual':
      return 'manual dispatch';
  }
}

// --- Admission gate (debounce + concurrency) -------------------------------

export type TriggerAdmission =
  | { action: 'run'; prompt: string }
  | {
      action: 'skip';
      reason: 'disabled' | 'invalid' | 'filtered' | 'debounced' | 'at_capacity';
      detail?: string;
    };

/**
 * Per-agent admission gate. Tracks, per trigger node id, the last fire time
 * (for leading-edge debounce coalescing) and the number of in-flight runs (for
 * the concurrency ceiling). Stateful, mirroring `BudgetLedger`: the listener
 * owns one `TriggerGate` per agent, calls `admit(...)` for each inbound event,
 * and `complete(id)` when the resulting run settles.
 *
 * Debounce is leading-edge: the first event of a burst fires and subsequent
 * events within `debounceMs` are coalesced away. This is deterministic and
 * timer-free, which keeps the engine pure and unit-testable; a trailing-edge
 * variant would require the runtime's scheduler and lives in the listener.
 */
export class TriggerGate {
  private readonly lastFire = new Map<string, number>();
  private readonly inFlight = new Map<string, number>();

  admit(
    config: ResolvedTriggerConfig,
    event: TriggerEvent,
    now: number,
  ): TriggerAdmission {
    if (!config.enabled) return { action: 'skip', reason: 'disabled' };

    const problems = validateTrigger(config);
    if (problems.length > 0) {
      return { action: 'skip', reason: 'invalid', detail: problems.join('; ') };
    }

    if (config.source === 'fileWatch' && !matchesFileEvent(config, event)) {
      return { action: 'skip', reason: 'filtered', detail: 'file event/glob mismatch' };
    }

    const filter = evaluateFilter(config.filter, event);
    if (!filter.matched) {
      return { action: 'skip', reason: 'filtered', detail: filter.error ?? filter.reason };
    }

    if (config.debounceMs > 0) {
      const last = this.lastFire.get(config.triggerNodeId);
      if (last !== undefined && now - last < config.debounceMs) {
        return { action: 'skip', reason: 'debounced' };
      }
    }

    const running = this.inFlight.get(config.triggerNodeId) ?? 0;
    if (running >= config.maxConcurrent) {
      return { action: 'skip', reason: 'at_capacity', detail: `${running} in flight` };
    }

    // Admit: reserve a concurrency slot and stamp the debounce window.
    this.inFlight.set(config.triggerNodeId, running + 1);
    this.lastFire.set(config.triggerNodeId, now);
    return { action: 'run', prompt: renderPrompt(config, event) };
  }

  /** Release a concurrency slot after an admitted run settles. */
  complete(triggerNodeId: string): void {
    const running = this.inFlight.get(triggerNodeId) ?? 0;
    if (running <= 1) this.inFlight.delete(triggerNodeId);
    else this.inFlight.set(triggerNodeId, running - 1);
  }

  /** Current in-flight run count for a trigger (0 when idle). Exposed for tests/telemetry. */
  activeRuns(triggerNodeId: string): number {
    return this.inFlight.get(triggerNodeId) ?? 0;
  }
}
