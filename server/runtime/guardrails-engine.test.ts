import { describe, expect, it } from 'vitest';
import type { ResolvedGuardrailConfig } from '../../shared/agent-config';
import { evaluateGuardrails, firstBlocking } from './guardrails-engine';

function makeGuardrail(
  overrides: Partial<ResolvedGuardrailConfig> = {},
): ResolvedGuardrailConfig {
  return {
    guardrailNodeId: 'g1',
    label: 'Test Guardrail',
    enabled: true,
    checkInput: true,
    checkOutput: true,
    maxInputChars: 0,
    blockedTerms: [],
    piiCategories: [],
    action: 'block',
    blockMessage: '',
    ...overrides,
  };
}

describe('evaluateGuardrails', () => {
  it('returns no violations when no guardrails are configured', () => {
    expect(evaluateGuardrails([], 'anything', 'input')).toEqual([]);
    expect(evaluateGuardrails(undefined, 'anything', 'input')).toEqual([]);
  });

  it('skips disabled guardrails', () => {
    const violations = evaluateGuardrails(
      [makeGuardrail({ enabled: false, blockedTerms: ['secret'] })],
      'this is a secret',
      'input',
    );
    expect(violations).toHaveLength(0);
  });

  it('skips guardrails that do not apply to the current direction', () => {
    const inputOnly = makeGuardrail({
      checkOutput: false,
      blockedTerms: ['leak'],
    });
    expect(evaluateGuardrails([inputOnly], 'leak in output', 'output')).toHaveLength(0);
    expect(evaluateGuardrails([inputOnly], 'leak in input', 'input')).toHaveLength(1);
  });

  it('flags overly long input only on the input direction', () => {
    const guardrail = makeGuardrail({ maxInputChars: 5 });
    expect(evaluateGuardrails([guardrail], 'too long', 'input')[0].rule).toBe('max_input_chars');
    expect(evaluateGuardrails([guardrail], 'too long', 'output')).toHaveLength(0);
  });

  it('matches blocked terms case-insensitively', () => {
    const violations = evaluateGuardrails(
      [makeGuardrail({ blockedTerms: ['Confidential'] })],
      'this is CONFIDENTIAL data',
      'input',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('blocked_term');
  });

  it('detects email PII', () => {
    const violations = evaluateGuardrails(
      [makeGuardrail({ piiCategories: ['email'] })],
      'reach me at john.doe@example.com please',
      'output',
    );
    expect(violations[0].rule).toBe('pii_email');
  });

  it('detects SSN PII', () => {
    const violations = evaluateGuardrails(
      [makeGuardrail({ piiCategories: ['ssn'] })],
      'my number is 123-45-6789',
      'input',
    );
    expect(violations[0].rule).toBe('pii_ssn');
  });

  it('detects credit-card-shaped numbers', () => {
    const violations = evaluateGuardrails(
      [makeGuardrail({ piiCategories: ['credit_card'] })],
      'card 4111 1111 1111 1111',
      'input',
    );
    expect(violations[0].rule).toBe('pii_credit_card');
  });

  it('aggregates violations across multiple guardrails', () => {
    const violations = evaluateGuardrails(
      [
        makeGuardrail({ guardrailNodeId: 'a', blockedTerms: ['foo'], action: 'warn' }),
        makeGuardrail({ guardrailNodeId: 'b', piiCategories: ['email'], action: 'block' }),
      ],
      'foo bar test@example.com',
      'input',
    );
    expect(violations.map((v) => v.guardrailNodeId).sort()).toEqual(['a', 'b']);
  });
});

describe('firstBlocking', () => {
  it('returns the first block-action violation', () => {
    const v1 = {
      guardrailNodeId: 'a',
      label: 'a',
      direction: 'input' as const,
      rule: 'blocked_term' as const,
      detail: 'x',
      action: 'warn' as const,
      blockMessage: '',
    };
    const v2 = { ...v1, guardrailNodeId: 'b', action: 'block' as const };
    expect(firstBlocking([v1, v2])).toBe(v2);
    expect(firstBlocking([v1])).toBeNull();
  });
});
