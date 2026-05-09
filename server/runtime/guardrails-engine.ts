import type {
  GuardrailPiiCategory,
  ResolvedGuardrailConfig,
} from '../../shared/agent-config';

export type GuardrailDirection = 'input' | 'output';

export interface GuardrailViolation {
  guardrailNodeId: string;
  label: string;
  direction: GuardrailDirection;
  rule: GuardrailRuleId;
  detail: string;
  action: 'block' | 'warn';
  blockMessage: string;
}

export type GuardrailRuleId =
  | 'max_input_chars'
  | 'blocked_term'
  | 'pii_email'
  | 'pii_ssn'
  | 'pii_credit_card';

const PII_PATTERNS: Record<GuardrailPiiCategory, { rule: GuardrailRuleId; regex: RegExp; label: string }> = {
  email: {
    rule: 'pii_email',
    label: 'email address',
    regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  },
  ssn: {
    rule: 'pii_ssn',
    label: 'US Social Security Number',
    // Word-boundary anchored 3-2-4 digit pattern. Permissive on its own —
    // operators should still review the warning before enabling `block`.
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
  },
  credit_card: {
    rule: 'pii_credit_card',
    // Conservative 13-19 digit run with optional separators. Not a Luhn
    // check; the goal is "looks like a card", not strict validation.
    label: 'credit-card-shaped number',
    regex: /\b(?:\d[ -]?){13,19}\b/,
  },
};

const DEFAULT_BLOCK_MESSAGE =
  'This message was blocked by a guardrail. Update or remove the flagged content and try again.';

/**
 * Evaluate a single piece of text against the configured guardrails for a
 * given direction. Returns the list of violations across all guardrail
 * nodes. The caller decides what to do with `warn` vs `block`.
 */
export function evaluateGuardrails(
  guardrails: ResolvedGuardrailConfig[] | undefined,
  text: string,
  direction: GuardrailDirection,
): GuardrailViolation[] {
  if (!guardrails || guardrails.length === 0) return [];
  const violations: GuardrailViolation[] = [];

  for (const g of guardrails) {
    if (!g.enabled) continue;
    if (direction === 'input' && !g.checkInput) continue;
    if (direction === 'output' && !g.checkOutput) continue;

    const blockMessage = g.blockMessage.trim() || DEFAULT_BLOCK_MESSAGE;

    // Length check is input-only — output is bounded by model max_tokens
    // and is not a useful failure mode here.
    if (
      direction === 'input'
      && g.maxInputChars > 0
      && text.length > g.maxInputChars
    ) {
      violations.push({
        guardrailNodeId: g.guardrailNodeId,
        label: g.label,
        direction,
        rule: 'max_input_chars',
        detail: `Input length ${text.length} exceeds maximum ${g.maxInputChars}.`,
        action: g.action,
        blockMessage,
      });
    }

    const lowerText = text.toLowerCase();
    for (const term of g.blockedTerms) {
      const needle = term.trim().toLowerCase();
      if (!needle) continue;
      if (lowerText.includes(needle)) {
        violations.push({
          guardrailNodeId: g.guardrailNodeId,
          label: g.label,
          direction,
          rule: 'blocked_term',
          detail: `Matched blocked term "${term}".`,
          action: g.action,
          blockMessage,
        });
      }
    }

    for (const cat of g.piiCategories) {
      const pattern = PII_PATTERNS[cat];
      if (!pattern) continue;
      if (pattern.regex.test(text)) {
        violations.push({
          guardrailNodeId: g.guardrailNodeId,
          label: g.label,
          direction,
          rule: pattern.rule,
          detail: `Detected ${pattern.label}.`,
          action: g.action,
          blockMessage,
        });
      }
    }
  }

  return violations;
}

/** First `block`-action violation, or null if everything is `warn`. */
export function firstBlocking(
  violations: GuardrailViolation[],
): GuardrailViolation | null {
  return violations.find((v) => v.action === 'block') ?? null;
}
