# Provider Replay Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add replay normalization so conversation history is automatically transformed to match each LLM provider's API requirements before sending, ported from OpenClaw's battle-tested replay policy system.

**Architecture:** Core replay types live in `shared/plugin-sdk/replay.ts`. Pre-built policy constructors and family hooks live in `shared/plugin-sdk/replay-family.ts` and `server/providers/replay-helpers.ts`. Pure transform functions live in `server/providers/replay-transforms.ts`. The normalizer in `server/providers/replay-normalizer.ts` orchestrates the pipeline and is called by `RunCoordinator` at prompt time. Four new optional hooks are added to `ProviderPluginDefinition`.

**Tech Stack:** TypeScript, Vitest, @mariozechner/pi-agent-core (AgentMessage type), @mariozechner/pi-coding-agent (SessionManager)

**Spec:** `docs/superpowers/specs/2026-04-10-provider-replay-normalization-design.md`

---

## File Structure

### Files to create

| File | Responsibility |
|------|---------------|
| `shared/plugin-sdk/replay.ts` | Core types: `ProviderReplayPolicy`, contexts, families, reasoning output mode |
| `shared/plugin-sdk/replay-family.ts` | `buildProviderReplayFamilyHooks()` convenience helper mapping family names to hook sets |
| `server/providers/replay-helpers.ts` | Pre-built policy constructors: `buildOpenAICompatibleReplayPolicy`, `buildStrictAnthropicReplayPolicy`, `buildAnthropicReplayPolicyForModel`, `buildGoogleGeminiReplayPolicy`, etc. |
| `server/providers/replay-transforms.ts` | Pure transform functions: `sanitizeToolCallIds`, `dropThinkingBlocks`, `repairToolUseResultPairing`, `validateGeminiTurns`, `validateAnthropicTurns`, `applyAssistantFirstOrderingFix`, `sanitizeThoughtSignatures` |
| `server/providers/replay-normalizer.ts` | Main `normalizeReplayHistory()` entry point — resolves policy, runs generic transforms, calls plugin hooks, validates turns |
| `server/providers/replay-helpers.test.ts` | Tests for policy builders and `shouldPreserveThinkingBlocks` |
| `server/providers/replay-transforms.test.ts` | Tests for each pure transform function |
| `server/providers/replay-normalizer.test.ts` | Integration tests for the full normalization pipeline with mock plugins |
| `shared/plugin-sdk/replay-family.test.ts` | Tests for `buildProviderReplayFamilyHooks` |

### Files to modify

| File | Change |
|------|--------|
| `shared/plugin-sdk/types.ts` | Add four optional replay hooks to `ProviderPluginDefinition` |
| `shared/plugin-sdk/index.ts` | Re-export types from `replay.ts` and export `buildProviderReplayFamilyHooks` from `replay-family.ts` |
| `server/providers/plugins/openrouter.ts` | Spread `passthrough-gemini` replay family hooks, add `resolveReasoningOutputMode` |
| `server/agents/run-coordinator.ts` | Accept `ProviderPluginRegistry` in constructor, call `normalizeReplayHistory()` before `setSessionContext()` |
| `server/agents/agent-manager.ts` | Pass `pluginRegistry` to `RunCoordinator` constructor |

---

### Task 1: Core Replay Types

**Files:**
- Create: `shared/plugin-sdk/replay.ts`

- [ ] **Step 1: Create the replay types file**

```typescript
// shared/plugin-sdk/replay.ts

import type { AgentMessage } from '@mariozechner/pi-agent-core';

// --- Replay Policy ---

export type ProviderReplaySanitizeMode = 'full' | 'images-only';
export type ProviderReplayToolCallIdMode = 'strict' | 'strict9';
export type ProviderReasoningOutputMode = 'native' | 'tagged';

export type ProviderReplayPolicy = {
  sanitizeMode?: ProviderReplaySanitizeMode;
  sanitizeToolCallIds?: boolean;
  toolCallIdMode?: ProviderReplayToolCallIdMode;
  preserveNativeAnthropicToolUseIds?: boolean;
  preserveSignatures?: boolean;
  sanitizeThoughtSignatures?: {
    allowBase64Only?: boolean;
    includeCamelCase?: boolean;
  };
  dropThinkingBlocks?: boolean;
  repairToolUseResultPairing?: boolean;
  applyAssistantFirstOrderingFix?: boolean;
  validateGeminiTurns?: boolean;
  validateAnthropicTurns?: boolean;
  allowSyntheticToolResults?: boolean;
};

// --- Contexts ---

export type ProviderReplayPolicyContext = {
  provider: string;
  modelId?: string;
  modelApi?: string | null;
};

export type ProviderReplaySessionEntry = {
  customType: string;
  data?: unknown;
};

export type ProviderReplaySessionState = {
  getCustomEntries(): ProviderReplaySessionEntry[];
  appendCustomEntry(customType: string, data: unknown): void;
};

export type ProviderSanitizeReplayHistoryContext = ProviderReplayPolicyContext & {
  sessionId: string;
  messages: AgentMessage[];
  allowedToolNames?: Iterable<string>;
  sessionState?: ProviderReplaySessionState;
};

export type ProviderValidateReplayTurnsContext = ProviderReplayPolicyContext & {
  sessionId?: string;
  messages: AgentMessage[];
  sessionState?: ProviderReplaySessionState;
};

export type ProviderReasoningOutputModeContext = ProviderReplayPolicyContext;

// --- Replay Families ---

export type ProviderReplayFamily =
  | 'openai-compatible'
  | 'anthropic-by-model'
  | 'google-gemini'
  | 'passthrough-gemini'
  | 'hybrid-anthropic-openai';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `shared/plugin-sdk/replay.ts`

- [ ] **Step 3: Commit**

```bash
git add shared/plugin-sdk/replay.ts
git commit -m "feat: add core replay normalization types"
```

---

### Task 2: Extend ProviderPluginDefinition with Replay Hooks

**Files:**
- Modify: `shared/plugin-sdk/types.ts:37-51`
- Modify: `shared/plugin-sdk/index.ts`

- [ ] **Step 1: Add replay hook imports and fields to types.ts**

In `shared/plugin-sdk/types.ts`, add this import at the top (after the existing import):

```typescript
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderValidateReplayTurnsContext,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
} from './replay';
```

Then add four optional hooks to the `ProviderPluginDefinition` interface, after the `webFetch` field (line 50):

```typescript
  // --- Replay normalization hooks ---
  buildReplayPolicy?: (
    ctx: ProviderReplayPolicyContext,
  ) => ProviderReplayPolicy | null | undefined;
  sanitizeReplayHistory?: (
    ctx: ProviderSanitizeReplayHistoryContext,
  ) => Promise<AgentMessage[] | null | undefined> | AgentMessage[] | null | undefined;
  validateReplayTurns?: (
    ctx: ProviderValidateReplayTurnsContext,
  ) => Promise<AgentMessage[] | null | undefined> | AgentMessage[] | null | undefined;
  resolveReasoningOutputMode?: (
    ctx: ProviderReasoningOutputModeContext,
  ) => ProviderReasoningOutputMode | null | undefined;
```

- [ ] **Step 2: Add replay type re-exports to index.ts**

In `shared/plugin-sdk/index.ts`, add at the end:

```typescript
export type {
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderReplaySanitizeMode,
  ProviderReplayToolCallIdMode,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplaySessionEntry,
  ProviderReplaySessionState,
  ProviderSanitizeReplayHistoryContext,
  ProviderValidateReplayTurnsContext,
  ProviderReplayFamily,
} from './replay';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. The `ProviderPluginDefinition` interface now has four new optional fields, all existing code remains valid.

- [ ] **Step 4: Commit**

```bash
git add shared/plugin-sdk/types.ts shared/plugin-sdk/index.ts
git commit -m "feat: add replay normalization hooks to ProviderPluginDefinition"
```

---

### Task 3: Replay Policy Builders

**Files:**
- Create: `server/providers/replay-helpers.ts`
- Test: `server/providers/replay-helpers.test.ts`

- [ ] **Step 1: Write tests for policy builders**

```typescript
// server/providers/replay-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildOpenAICompatibleReplayPolicy,
  buildStrictAnthropicReplayPolicy,
  buildAnthropicReplayPolicyForModel,
  buildNativeAnthropicReplayPolicyForModel,
  buildGoogleGeminiReplayPolicy,
  buildPassthroughGeminiSanitizingReplayPolicy,
  buildHybridAnthropicOrOpenAIReplayPolicy,
  shouldPreserveThinkingBlocks,
  resolveTaggedReasoningOutputMode,
} from './replay-helpers';

describe('buildOpenAICompatibleReplayPolicy', () => {
  it('returns undefined for non-openai modelApi', () => {
    expect(buildOpenAICompatibleReplayPolicy('anthropic-messages')).toBeUndefined();
    expect(buildOpenAICompatibleReplayPolicy(null)).toBeUndefined();
    expect(buildOpenAICompatibleReplayPolicy(undefined)).toBeUndefined();
  });

  it('returns strict policy for openai-completions', () => {
    const policy = buildOpenAICompatibleReplayPolicy('openai-completions');
    expect(policy).toBeDefined();
    expect(policy!.sanitizeToolCallIds).toBe(true);
    expect(policy!.toolCallIdMode).toBe('strict');
    expect(policy!.applyAssistantFirstOrderingFix).toBe(true);
    expect(policy!.validateGeminiTurns).toBe(true);
    expect(policy!.validateAnthropicTurns).toBe(true);
  });

  it('returns minimal policy for openai-responses', () => {
    const policy = buildOpenAICompatibleReplayPolicy('openai-responses');
    expect(policy).toBeDefined();
    expect(policy!.sanitizeToolCallIds).toBe(true);
    expect(policy!.applyAssistantFirstOrderingFix).toBe(false);
    expect(policy!.validateGeminiTurns).toBe(false);
  });
});

describe('buildStrictAnthropicReplayPolicy', () => {
  it('returns full sanitize policy with defaults', () => {
    const policy = buildStrictAnthropicReplayPolicy();
    expect(policy.sanitizeMode).toBe('full');
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe('strict');
    expect(policy.preserveSignatures).toBe(true);
    expect(policy.repairToolUseResultPairing).toBe(true);
    expect(policy.validateAnthropicTurns).toBe(true);
    expect(policy.allowSyntheticToolResults).toBe(true);
  });

  it('respects dropThinkingBlocks option', () => {
    const policy = buildStrictAnthropicReplayPolicy({ dropThinkingBlocks: true });
    expect(policy.dropThinkingBlocks).toBe(true);
  });

  it('respects preserveNativeAnthropicToolUseIds option', () => {
    const policy = buildStrictAnthropicReplayPolicy({
      preserveNativeAnthropicToolUseIds: true,
    });
    expect(policy.preserveNativeAnthropicToolUseIds).toBe(true);
  });
});

describe('shouldPreserveThinkingBlocks', () => {
  it('returns false for non-Claude models', () => {
    expect(shouldPreserveThinkingBlocks('gpt-4o')).toBe(false);
    expect(shouldPreserveThinkingBlocks('gemini-pro')).toBe(false);
    expect(shouldPreserveThinkingBlocks(undefined)).toBe(false);
  });

  it('returns false for Claude 3.x models', () => {
    expect(shouldPreserveThinkingBlocks('claude-3-7-sonnet-latest')).toBe(false);
    expect(shouldPreserveThinkingBlocks('claude-3-5-sonnet-20241022')).toBe(false);
  });

  it('returns true for Claude 4.5+ models', () => {
    expect(shouldPreserveThinkingBlocks('claude-opus-4-5-20250514')).toBe(true);
    expect(shouldPreserveThinkingBlocks('claude-sonnet-4-5-20250514')).toBe(true);
    expect(shouldPreserveThinkingBlocks('claude-haiku-4-5-20251001')).toBe(true);
    expect(shouldPreserveThinkingBlocks('claude-opus-4-6')).toBe(true);
    expect(shouldPreserveThinkingBlocks('claude-sonnet-4-6')).toBe(true);
  });

  it('returns true for future Claude models', () => {
    expect(shouldPreserveThinkingBlocks('claude-5-opus')).toBe(true);
    expect(shouldPreserveThinkingBlocks('claude-10-sonnet')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(shouldPreserveThinkingBlocks('Claude-Opus-4-5')).toBe(true);
    expect(shouldPreserveThinkingBlocks('CLAUDE-3-5-SONNET')).toBe(false);
  });
});

describe('buildAnthropicReplayPolicyForModel', () => {
  it('drops thinking blocks for Claude 3.x', () => {
    const policy = buildAnthropicReplayPolicyForModel('claude-3-7-sonnet-latest');
    expect(policy.dropThinkingBlocks).toBe(true);
  });

  it('preserves thinking blocks for Claude 4.5+', () => {
    const policy = buildAnthropicReplayPolicyForModel('claude-opus-4-5-20250514');
    expect(policy.dropThinkingBlocks).toBe(false);
  });

  it('does not drop thinking for non-Claude models', () => {
    const policy = buildAnthropicReplayPolicyForModel('gpt-4o');
    expect(policy.dropThinkingBlocks).toBe(false);
  });
});

describe('buildNativeAnthropicReplayPolicyForModel', () => {
  it('preserves native Anthropic tool use IDs', () => {
    const policy = buildNativeAnthropicReplayPolicyForModel('claude-opus-4-5');
    expect(policy.preserveNativeAnthropicToolUseIds).toBe(true);
    expect(policy.sanitizeToolCallIds).toBe(true);
  });
});

describe('buildGoogleGeminiReplayPolicy', () => {
  it('returns comprehensive Gemini policy', () => {
    const policy = buildGoogleGeminiReplayPolicy();
    expect(policy.sanitizeMode).toBe('full');
    expect(policy.sanitizeToolCallIds).toBe(true);
    expect(policy.toolCallIdMode).toBe('strict');
    expect(policy.sanitizeThoughtSignatures).toEqual({
      allowBase64Only: true,
      includeCamelCase: true,
    });
    expect(policy.repairToolUseResultPairing).toBe(true);
    expect(policy.applyAssistantFirstOrderingFix).toBe(true);
    expect(policy.validateGeminiTurns).toBe(true);
    expect(policy.validateAnthropicTurns).toBe(false);
    expect(policy.allowSyntheticToolResults).toBe(true);
  });
});

describe('buildPassthroughGeminiSanitizingReplayPolicy', () => {
  it('sanitizes thought signatures for Gemini models', () => {
    const policy = buildPassthroughGeminiSanitizingReplayPolicy('google/gemini-2.5-pro');
    expect(policy.sanitizeThoughtSignatures).toEqual({
      allowBase64Only: true,
      includeCamelCase: true,
    });
  });

  it('skips thought signature sanitization for non-Gemini models', () => {
    const policy = buildPassthroughGeminiSanitizingReplayPolicy('anthropic/claude-opus-4-5');
    expect(policy.sanitizeThoughtSignatures).toBeUndefined();
  });

  it('returns minimal policy flags', () => {
    const policy = buildPassthroughGeminiSanitizingReplayPolicy('anything');
    expect(policy.applyAssistantFirstOrderingFix).toBe(false);
    expect(policy.validateGeminiTurns).toBe(false);
    expect(policy.validateAnthropicTurns).toBe(false);
  });
});

describe('buildHybridAnthropicOrOpenAIReplayPolicy', () => {
  it('delegates to Anthropic for anthropic-messages API', () => {
    const policy = buildHybridAnthropicOrOpenAIReplayPolicy(
      { provider: 'test', modelId: 'claude-opus-4-5', modelApi: 'anthropic-messages' },
    );
    expect(policy).toBeDefined();
    expect(policy!.sanitizeMode).toBe('full');
    expect(policy!.validateAnthropicTurns).toBe(true);
  });

  it('delegates to OpenAI for openai-completions API', () => {
    const policy = buildHybridAnthropicOrOpenAIReplayPolicy(
      { provider: 'test', modelId: 'gpt-4o', modelApi: 'openai-completions' },
    );
    expect(policy).toBeDefined();
    expect(policy!.sanitizeToolCallIds).toBe(true);
    expect(policy!.applyAssistantFirstOrderingFix).toBe(true);
  });

  it('returns undefined for unknown API', () => {
    const policy = buildHybridAnthropicOrOpenAIReplayPolicy(
      { provider: 'test', modelApi: 'custom-api' },
    );
    expect(policy).toBeUndefined();
  });
});

describe('resolveTaggedReasoningOutputMode', () => {
  it('returns tagged', () => {
    expect(resolveTaggedReasoningOutputMode()).toBe('tagged');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-helpers.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./replay-helpers` not found

- [ ] **Step 3: Implement replay-helpers.ts**

```typescript
// server/providers/replay-helpers.ts

import type {
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderReasoningOutputMode,
} from '../../shared/plugin-sdk/replay';

export function buildOpenAICompatibleReplayPolicy(
  modelApi: string | null | undefined,
): ProviderReplayPolicy | undefined {
  if (
    modelApi !== 'openai-completions' &&
    modelApi !== 'openai-responses' &&
    modelApi !== 'openai-codex-responses' &&
    modelApi !== 'azure-openai-responses'
  ) {
    return undefined;
  }

  return {
    sanitizeToolCallIds: true,
    toolCallIdMode: 'strict',
    ...(modelApi === 'openai-completions'
      ? {
          applyAssistantFirstOrderingFix: true,
          validateGeminiTurns: true,
          validateAnthropicTurns: true,
        }
      : {
          applyAssistantFirstOrderingFix: false,
          validateGeminiTurns: false,
          validateAnthropicTurns: false,
        }),
  };
}

export function buildStrictAnthropicReplayPolicy(
  options: {
    dropThinkingBlocks?: boolean;
    sanitizeToolCallIds?: boolean;
    preserveNativeAnthropicToolUseIds?: boolean;
  } = {},
): ProviderReplayPolicy {
  const sanitizeToolCallIds = options.sanitizeToolCallIds ?? true;
  return {
    sanitizeMode: 'full',
    ...(sanitizeToolCallIds
      ? {
          sanitizeToolCallIds: true,
          toolCallIdMode: 'strict' as const,
          ...(options.preserveNativeAnthropicToolUseIds
            ? { preserveNativeAnthropicToolUseIds: true }
            : {}),
        }
      : {}),
    preserveSignatures: true,
    repairToolUseResultPairing: true,
    validateAnthropicTurns: true,
    allowSyntheticToolResults: true,
    ...(options.dropThinkingBlocks ? { dropThinkingBlocks: true } : {}),
  };
}

/**
 * Returns true for Claude models that preserve thinking blocks in context
 * natively (Opus 4.5+, Sonnet 4.5+, Haiku 4.5+). For these models, dropping
 * thinking blocks from prior turns breaks prompt cache prefix matching.
 */
export function shouldPreserveThinkingBlocks(modelId?: string): boolean {
  const id = (modelId ?? '').toLowerCase();
  if (!id.includes('claude')) {
    return false;
  }

  // Models that preserve thinking blocks natively (Claude 4.5+):
  // - claude-opus-4-x, claude-sonnet-4-x, claude-haiku-4-x
  // Models that require dropping thinking blocks:
  // - claude-3-7-sonnet, claude-3-5-sonnet, and earlier
  if (id.includes('opus-4') || id.includes('sonnet-4') || id.includes('haiku-4')) {
    return true;
  }

  // Future-proofing: claude-5-x, claude-6-x etc. should also preserve
  if (/claude-[5-9]/.test(id) || /claude-\d{2,}/.test(id)) {
    return true;
  }

  return false;
}

export function buildAnthropicReplayPolicyForModel(modelId?: string): ProviderReplayPolicy {
  const isClaude = (modelId ?? '').toLowerCase().includes('claude');
  return buildStrictAnthropicReplayPolicy({
    dropThinkingBlocks: isClaude && !shouldPreserveThinkingBlocks(modelId),
  });
}

export function buildNativeAnthropicReplayPolicyForModel(modelId?: string): ProviderReplayPolicy {
  const isClaude = (modelId ?? '').toLowerCase().includes('claude');
  return buildStrictAnthropicReplayPolicy({
    dropThinkingBlocks: isClaude && !shouldPreserveThinkingBlocks(modelId),
    sanitizeToolCallIds: true,
    preserveNativeAnthropicToolUseIds: true,
  });
}

export function buildHybridAnthropicOrOpenAIReplayPolicy(
  ctx: ProviderReplayPolicyContext,
  options: { anthropicModelDropThinkingBlocks?: boolean } = {},
): ProviderReplayPolicy | undefined {
  if (ctx.modelApi === 'anthropic-messages' || ctx.modelApi === 'bedrock-converse-stream') {
    const isClaude = (ctx.modelId ?? '').toLowerCase().includes('claude');
    return buildStrictAnthropicReplayPolicy({
      dropThinkingBlocks:
        options.anthropicModelDropThinkingBlocks &&
        isClaude &&
        !shouldPreserveThinkingBlocks(ctx.modelId),
    });
  }

  return buildOpenAICompatibleReplayPolicy(ctx.modelApi);
}

export function buildGoogleGeminiReplayPolicy(): ProviderReplayPolicy {
  return {
    sanitizeMode: 'full',
    sanitizeToolCallIds: true,
    toolCallIdMode: 'strict',
    sanitizeThoughtSignatures: {
      allowBase64Only: true,
      includeCamelCase: true,
    },
    repairToolUseResultPairing: true,
    applyAssistantFirstOrderingFix: true,
    validateGeminiTurns: true,
    validateAnthropicTurns: false,
    allowSyntheticToolResults: true,
  };
}

export function buildPassthroughGeminiSanitizingReplayPolicy(
  modelId?: string,
): ProviderReplayPolicy {
  const normalizedModelId = (modelId ?? '').toLowerCase();
  return {
    applyAssistantFirstOrderingFix: false,
    validateGeminiTurns: false,
    validateAnthropicTurns: false,
    ...(normalizedModelId.includes('gemini')
      ? {
          sanitizeThoughtSignatures: {
            allowBase64Only: true,
            includeCamelCase: true,
          },
        }
      : {}),
  };
}

export function resolveTaggedReasoningOutputMode(): ProviderReasoningOutputMode {
  return 'tagged';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-helpers.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-helpers.ts server/providers/replay-helpers.test.ts
git commit -m "feat: add replay policy builders for all provider families"
```

---

### Task 4: Replay Family Hooks Helper

**Files:**
- Create: `shared/plugin-sdk/replay-family.ts`
- Test: `shared/plugin-sdk/replay-family.test.ts`

- [ ] **Step 1: Write tests for the family hooks helper**

```typescript
// shared/plugin-sdk/replay-family.test.ts
import { describe, it, expect } from 'vitest';
import { buildProviderReplayFamilyHooks } from './replay-family';

describe('buildProviderReplayFamilyHooks', () => {
  it('returns buildReplayPolicy for openai-compatible', () => {
    const hooks = buildProviderReplayFamilyHooks({ family: 'openai-compatible' });
    expect(hooks.buildReplayPolicy).toBeTypeOf('function');
    expect(hooks.sanitizeReplayHistory).toBeUndefined();
    expect(hooks.resolveReasoningOutputMode).toBeUndefined();

    const policy = hooks.buildReplayPolicy!({
      provider: 'test',
      modelApi: 'openai-completions',
    });
    expect(policy).toBeDefined();
    expect(policy!.sanitizeToolCallIds).toBe(true);
  });

  it('returns buildReplayPolicy for anthropic-by-model', () => {
    const hooks = buildProviderReplayFamilyHooks({ family: 'anthropic-by-model' });
    expect(hooks.buildReplayPolicy).toBeTypeOf('function');

    const policy = hooks.buildReplayPolicy!({
      provider: 'test',
      modelId: 'claude-opus-4-5',
    });
    expect(policy).toBeDefined();
    expect(policy!.sanitizeMode).toBe('full');
    expect(policy!.dropThinkingBlocks).toBe(false);
  });

  it('returns all three hooks for google-gemini', () => {
    const hooks = buildProviderReplayFamilyHooks({ family: 'google-gemini' });
    expect(hooks.buildReplayPolicy).toBeTypeOf('function');
    expect(hooks.sanitizeReplayHistory).toBeTypeOf('function');
    expect(hooks.resolveReasoningOutputMode).toBeTypeOf('function');

    const mode = hooks.resolveReasoningOutputMode!({ provider: 'test' });
    expect(mode).toBe('tagged');
  });

  it('returns buildReplayPolicy for passthrough-gemini', () => {
    const hooks = buildProviderReplayFamilyHooks({ family: 'passthrough-gemini' });
    expect(hooks.buildReplayPolicy).toBeTypeOf('function');
    expect(hooks.sanitizeReplayHistory).toBeUndefined();

    const policy = hooks.buildReplayPolicy!({
      provider: 'test',
      modelId: 'google/gemini-2.5-pro',
    });
    expect(policy).toBeDefined();
    expect(policy!.sanitizeThoughtSignatures).toBeDefined();
  });

  it('returns buildReplayPolicy for hybrid-anthropic-openai', () => {
    const hooks = buildProviderReplayFamilyHooks({ family: 'hybrid-anthropic-openai' });
    expect(hooks.buildReplayPolicy).toBeTypeOf('function');

    const anthropicPolicy = hooks.buildReplayPolicy!({
      provider: 'test',
      modelApi: 'anthropic-messages',
      modelId: 'claude-opus-4-5',
    });
    expect(anthropicPolicy).toBeDefined();
    expect(anthropicPolicy!.validateAnthropicTurns).toBe(true);

    const openaiPolicy = hooks.buildReplayPolicy!({
      provider: 'test',
      modelApi: 'openai-completions',
    });
    expect(openaiPolicy).toBeDefined();
    expect(openaiPolicy!.applyAssistantFirstOrderingFix).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/plugin-sdk/replay-family.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./replay-family` not found

- [ ] **Step 3: Implement replay-family.ts**

```typescript
// shared/plugin-sdk/replay-family.ts

import type { ProviderPluginDefinition } from './types';
import type {
  ProviderReplayPolicyContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderReasoningOutputModeContext,
} from './replay';

// Import server-side helpers lazily to keep shared/ importable from both sides.
// The replay-family helper is consumed in server/providers/plugins/ where
// the server helpers are available.
import {
  buildOpenAICompatibleReplayPolicy,
  buildAnthropicReplayPolicyForModel,
  buildGoogleGeminiReplayPolicy,
  buildPassthroughGeminiSanitizingReplayPolicy,
  buildHybridAnthropicOrOpenAIReplayPolicy,
  sanitizeGoogleGeminiReplayHistory,
  resolveTaggedReasoningOutputMode,
} from '../../server/providers/replay-helpers';

type ProviderReplayFamilyHooks = Pick<
  ProviderPluginDefinition,
  'buildReplayPolicy' | 'sanitizeReplayHistory' | 'resolveReasoningOutputMode'
>;

type BuildProviderReplayFamilyHooksOptions =
  | { family: 'openai-compatible' }
  | { family: 'anthropic-by-model' }
  | { family: 'google-gemini' }
  | { family: 'passthrough-gemini' }
  | {
      family: 'hybrid-anthropic-openai';
      anthropicModelDropThinkingBlocks?: boolean;
    };

export function buildProviderReplayFamilyHooks(
  options: BuildProviderReplayFamilyHooksOptions,
): ProviderReplayFamilyHooks {
  switch (options.family) {
    case 'openai-compatible':
      return {
        buildReplayPolicy: (ctx: ProviderReplayPolicyContext) =>
          buildOpenAICompatibleReplayPolicy(ctx.modelApi),
      };
    case 'anthropic-by-model':
      return {
        buildReplayPolicy: (ctx: ProviderReplayPolicyContext) =>
          buildAnthropicReplayPolicyForModel(ctx.modelId),
      };
    case 'google-gemini':
      return {
        buildReplayPolicy: () => buildGoogleGeminiReplayPolicy(),
        sanitizeReplayHistory: (ctx: ProviderSanitizeReplayHistoryContext) =>
          sanitizeGoogleGeminiReplayHistory(ctx),
        resolveReasoningOutputMode: (_ctx: ProviderReasoningOutputModeContext) =>
          resolveTaggedReasoningOutputMode(),
      };
    case 'passthrough-gemini':
      return {
        buildReplayPolicy: (ctx: ProviderReplayPolicyContext) =>
          buildPassthroughGeminiSanitizingReplayPolicy(ctx.modelId),
      };
    case 'hybrid-anthropic-openai':
      return {
        buildReplayPolicy: (ctx: ProviderReplayPolicyContext) =>
          buildHybridAnthropicOrOpenAIReplayPolicy(ctx, {
            anthropicModelDropThinkingBlocks: options.anthropicModelDropThinkingBlocks,
          }),
      };
  }
}
```

Note: `sanitizeGoogleGeminiReplayHistory` will be implemented in `server/providers/replay-helpers.ts` — it needs to be added there. It was listed in the spec but not yet coded in Task 3. Add it to `replay-helpers.ts` now:

```typescript
// Append to server/providers/replay-helpers.ts

import type {
  ProviderSanitizeReplayHistoryContext,
  ProviderReplaySessionState,
} from '../../shared/plugin-sdk/replay';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

const GOOGLE_TURN_ORDERING_CUSTOM_TYPE = 'google-turn-ordering-bootstrap';
const GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT = '(session bootstrap)';

export function sanitizeGoogleGeminiReplayHistory(
  ctx: ProviderSanitizeReplayHistoryContext,
): AgentMessage[] {
  const messages = sanitizeGoogleAssistantFirstOrdering(ctx.messages);
  if (
    messages !== ctx.messages &&
    ctx.sessionState &&
    !hasGoogleTurnOrderingMarker(ctx.sessionState)
  ) {
    markGoogleTurnOrderingMarker(ctx.sessionState);
  }
  return messages;
}

function sanitizeGoogleAssistantFirstOrdering(messages: AgentMessage[]): AgentMessage[] {
  const first = messages[0] as { role?: unknown; content?: unknown } | undefined;
  const role = first?.role;
  const content = first?.content;
  if (
    role === 'user' &&
    typeof content === 'string' &&
    content.trim() === GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT
  ) {
    return messages;
  }
  if (role !== 'assistant') {
    return messages;
  }

  const bootstrap: AgentMessage = {
    role: 'user',
    content: GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT,
    timestamp: Date.now(),
  } as AgentMessage;

  return [bootstrap, ...messages];
}

function hasGoogleTurnOrderingMarker(sessionState: ProviderReplaySessionState): boolean {
  return sessionState
    .getCustomEntries()
    .some((entry) => entry.customType === GOOGLE_TURN_ORDERING_CUSTOM_TYPE);
}

function markGoogleTurnOrderingMarker(sessionState: ProviderReplaySessionState): void {
  sessionState.appendCustomEntry(GOOGLE_TURN_ORDERING_CUSTOM_TYPE, {
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 4: Update index.ts barrel export**

In `shared/plugin-sdk/index.ts`, add:

```typescript
export { buildProviderReplayFamilyHooks } from './replay-family';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/plugin-sdk/replay-family.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add shared/plugin-sdk/replay-family.ts shared/plugin-sdk/replay-family.test.ts shared/plugin-sdk/index.ts server/providers/replay-helpers.ts
git commit -m "feat: add replay family hooks helper with Gemini history sanitization"
```

---

### Task 5: Replay Transforms — Tool Call ID Sanitization

**Files:**
- Create: `server/providers/replay-transforms.ts`
- Create: `server/providers/replay-transforms.test.ts`

- [ ] **Step 1: Write tests for sanitizeToolCallIds**

```typescript
// server/providers/replay-transforms.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeToolCallIds } from './replay-transforms';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

function userMsg(content: string): AgentMessage {
  return { role: 'user', content, timestamp: Date.now() } as AgentMessage;
}

function assistantMsg(content: any[]): AgentMessage {
  return { role: 'assistant', content, timestamp: Date.now() } as AgentMessage;
}

function toolResultMsg(toolCallId: string, toolName: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: 'result' }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage;
}

describe('sanitizeToolCallIds', () => {
  it('returns empty array for empty input', () => {
    expect(sanitizeToolCallIds([], 'strict')).toEqual([]);
  });

  it('rewrites tool call IDs in strict mode', () => {
    const messages: AgentMessage[] = [
      userMsg('hello'),
      assistantMsg([
        { type: 'tool_use', id: 'original-id-123', name: 'calculator', input: {} },
      ]),
      toolResultMsg('original-id-123', 'calculator'),
    ];

    const result = sanitizeToolCallIds(messages, 'strict');

    const assistantContent = (result[1] as any).content;
    const toolUseBlock = assistantContent.find((b: any) => b.type === 'tool_use');
    expect(toolUseBlock.id).toMatch(/^call_/);
    expect(toolUseBlock.id).not.toBe('original-id-123');

    const toolResult = result[2] as any;
    expect(toolResult.toolCallId).toBe(toolUseBlock.id);
  });

  it('preserves native Anthropic tool use IDs when option set', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        { type: 'tool_use', id: 'toolu_abc123', name: 'calc', input: {} },
      ]),
      toolResultMsg('toolu_abc123', 'calc'),
    ];

    const result = sanitizeToolCallIds(messages, 'strict', {
      preserveNativeAnthropicToolUseIds: true,
    });

    const toolUseBlock = (result[0] as any).content.find((b: any) => b.type === 'tool_use');
    expect(toolUseBlock.id).toBe('toolu_abc123');
    expect((result[1] as any).toolCallId).toBe('toolu_abc123');
  });

  it('maintains consistent mapping across multiple tool calls', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        { type: 'tool_use', id: 'id-1', name: 'a', input: {} },
        { type: 'tool_use', id: 'id-2', name: 'b', input: {} },
      ]),
      toolResultMsg('id-1', 'a'),
      toolResultMsg('id-2', 'b'),
    ];

    const result = sanitizeToolCallIds(messages, 'strict');

    const blocks = (result[0] as any).content.filter((b: any) => b.type === 'tool_use');
    expect((result[1] as any).toolCallId).toBe(blocks[0].id);
    expect((result[2] as any).toolCallId).toBe(blocks[1].id);
  });

  it('does not modify messages without tool calls', () => {
    const messages: AgentMessage[] = [
      userMsg('hello'),
      assistantMsg([{ type: 'text', text: 'hi' }]),
    ];

    const result = sanitizeToolCallIds(messages, 'strict');
    expect(result).toEqual(messages);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./replay-transforms` not found

- [ ] **Step 3: Implement sanitizeToolCallIds**

```typescript
// server/providers/replay-transforms.ts

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ProviderReplayToolCallIdMode } from '../../shared/plugin-sdk/replay';

function generateToolCallId(index: number, mode: ProviderReplayToolCallIdMode): string {
  if (mode === 'strict9') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const pad = String(index).padStart(4, '0');
    // Deterministic 9-char: "tc" + 3 chars from index + 4 padding
    let result = 'tc';
    for (let i = 0; i < 3; i++) {
      result += chars[(index * 7 + i * 13) % chars.length];
    }
    return result + pad;
  }
  return `call_${String(index).padStart(4, '0')}`;
}

export function sanitizeToolCallIds(
  messages: AgentMessage[],
  mode: ProviderReplayToolCallIdMode,
  options?: { preserveNativeAnthropicToolUseIds?: boolean },
): AgentMessage[] {
  const idMap = new Map<string, string>();
  let callIndex = 0;
  let hasToolCalls = false;

  // First pass: build ID mapping from assistant tool_use blocks
  for (const msg of messages) {
    const raw = msg as { role?: string; content?: any[] };
    if (raw.role !== 'assistant' || !Array.isArray(raw.content)) continue;
    for (const block of raw.content) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        hasToolCalls = true;
        if (
          options?.preserveNativeAnthropicToolUseIds &&
          block.id.startsWith('toolu_')
        ) {
          idMap.set(block.id, block.id);
        } else {
          idMap.set(block.id, generateToolCallId(callIndex++, mode));
        }
      }
    }
  }

  if (!hasToolCalls) return messages;

  // Second pass: rewrite IDs
  return messages.map((msg) => {
    const raw = msg as any;

    if (raw.role === 'assistant' && Array.isArray(raw.content)) {
      const newContent = raw.content.map((block: any) => {
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          const newId = idMap.get(block.id);
          if (newId && newId !== block.id) {
            return { ...block, id: newId };
          }
        }
        return block;
      });
      const contentChanged = newContent.some(
        (b: any, i: number) => b !== raw.content[i],
      );
      return contentChanged ? { ...raw, content: newContent } : msg;
    }

    if (raw.role === 'toolResult' && typeof raw.toolCallId === 'string') {
      const newId = idMap.get(raw.toolCallId);
      if (newId && newId !== raw.toolCallId) {
        return { ...raw, toolCallId: newId };
      }
    }

    return msg;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-transforms.ts server/providers/replay-transforms.test.ts
git commit -m "feat: add tool call ID sanitization transform"
```

---

### Task 6: Replay Transforms — Thinking Blocks & Thought Signatures

**Files:**
- Modify: `server/providers/replay-transforms.ts`
- Modify: `server/providers/replay-transforms.test.ts`

- [ ] **Step 1: Write tests for dropThinkingBlocks and sanitizeThoughtSignatures**

Append to `server/providers/replay-transforms.test.ts`:

```typescript
import { dropThinkingBlocks, sanitizeThoughtSignatures } from './replay-transforms';

describe('dropThinkingBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(dropThinkingBlocks([])).toEqual([]);
  });

  it('removes thinking blocks from assistant messages', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Hello!' },
      ]),
    ];

    const result = dropThinkingBlocks(messages);
    const content = (result[0] as any).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
  });

  it('does not modify messages without thinking blocks', () => {
    const messages: AgentMessage[] = [
      userMsg('hi'),
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ];

    const result = dropThinkingBlocks(messages);
    expect(result).toEqual(messages);
  });

  it('preserves user and toolResult messages', () => {
    const messages: AgentMessage[] = [
      userMsg('test'),
      assistantMsg([
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'ok' },
      ]),
      toolResultMsg('id-1', 'calc'),
    ];

    const result = dropThinkingBlocks(messages);
    expect(result).toHaveLength(3);
    expect((result[0] as any).role).toBe('user');
    expect((result[2] as any).role).toBe('toolResult');
  });
});

describe('sanitizeThoughtSignatures', () => {
  it('returns empty array for empty input', () => {
    expect(sanitizeThoughtSignatures([], { allowBase64Only: true })).toEqual([]);
  });

  it('removes non-base64 signature fields when allowBase64Only is true', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        {
          type: 'thinking',
          thinking: 'analysis',
          signature: 'not-base64!@#',
        },
      ]),
    ];

    const result = sanitizeThoughtSignatures(messages, { allowBase64Only: true });
    const block = (result[0] as any).content[0];
    expect(block.signature).toBeUndefined();
  });

  it('preserves valid base64 signatures', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        {
          type: 'thinking',
          thinking: 'analysis',
          signature: 'dGVzdA==',
        },
      ]),
    ];

    const result = sanitizeThoughtSignatures(messages, { allowBase64Only: true });
    const block = (result[0] as any).content[0];
    expect(block.signature).toBe('dGVzdA==');
  });

  it('does not modify messages without thinking blocks', () => {
    const messages: AgentMessage[] = [
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ];

    const result = sanitizeThoughtSignatures(messages, { allowBase64Only: true });
    expect(result).toEqual(messages);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -10`
Expected: FAIL — `dropThinkingBlocks` and `sanitizeThoughtSignatures` not exported

- [ ] **Step 3: Implement both transforms**

Append to `server/providers/replay-transforms.ts`:

```typescript
export function dropThinkingBlocks(messages: AgentMessage[]): AgentMessage[] {
  let changed = false;
  const result = messages.map((msg) => {
    const raw = msg as any;
    if (raw.role !== 'assistant' || !Array.isArray(raw.content)) return msg;

    const filtered = raw.content.filter((block: any) => block.type !== 'thinking');
    if (filtered.length === raw.content.length) return msg;

    changed = true;
    return { ...raw, content: filtered };
  });
  return changed ? result : messages;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;

export function sanitizeThoughtSignatures(
  messages: AgentMessage[],
  options: { allowBase64Only?: boolean; includeCamelCase?: boolean },
): AgentMessage[] {
  let changed = false;
  const result = messages.map((msg) => {
    const raw = msg as any;
    if (raw.role !== 'assistant' || !Array.isArray(raw.content)) return msg;

    let blockChanged = false;
    const newContent = raw.content.map((block: any) => {
      if (block.type !== 'thinking') return block;

      const signatureKey = options.includeCamelCase ? 'signature' : 'signature';
      if (!(signatureKey in block)) return block;

      const sig = block[signatureKey];
      if (typeof sig !== 'string') return block;

      if (options.allowBase64Only && !BASE64_PATTERN.test(sig)) {
        blockChanged = true;
        const { [signatureKey]: _removed, ...rest } = block;
        return rest;
      }

      return block;
    });

    if (!blockChanged) return msg;
    changed = true;
    return { ...raw, content: newContent };
  });
  return changed ? result : messages;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-transforms.ts server/providers/replay-transforms.test.ts
git commit -m "feat: add thinking block and thought signature transforms"
```

---

### Task 7: Replay Transforms — Tool Use/Result Pairing Repair

**Files:**
- Modify: `server/providers/replay-transforms.ts`
- Modify: `server/providers/replay-transforms.test.ts`

- [ ] **Step 1: Write tests for repairToolUseResultPairing**

Append to `server/providers/replay-transforms.test.ts`:

```typescript
import { repairToolUseResultPairing } from './replay-transforms';

describe('repairToolUseResultPairing', () => {
  it('returns empty array for empty input', () => {
    expect(repairToolUseResultPairing([])).toEqual([]);
  });

  it('does not modify properly paired messages', () => {
    const messages: AgentMessage[] = [
      userMsg('go'),
      assistantMsg([
        { type: 'tool_use', id: 'tc-1', name: 'calc', input: { expr: '1+1' } },
      ]),
      toolResultMsg('tc-1', 'calc'),
    ];

    const result = repairToolUseResultPairing(messages);
    expect(result).toEqual(messages);
  });

  it('inserts synthetic result for orphaned tool_use', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        { type: 'tool_use', id: 'tc-1', name: 'calc', input: {} },
      ]),
      // No matching toolResult
      userMsg('next question'),
    ];

    const result = repairToolUseResultPairing(messages, {
      allowSyntheticToolResults: true,
    });
    expect(result).toHaveLength(3);
    const synthetic = result[1] as any;
    expect(synthetic.role).toBe('toolResult');
    expect(synthetic.toolCallId).toBe('tc-1');
    expect(synthetic.toolName).toBe('calc');
    expect(synthetic.isError).toBe(false);
  });

  it('removes orphaned toolResult with no matching tool_use', () => {
    const messages: AgentMessage[] = [
      userMsg('hi'),
      toolResultMsg('nonexistent-id', 'calc'),
      assistantMsg([{ type: 'text', text: 'ok' }]),
    ];

    const result = repairToolUseResultPairing(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m: any) => m.role !== 'toolResult')).toBe(true);
  });

  it('handles multiple tool calls with partial results', () => {
    const messages: AgentMessage[] = [
      assistantMsg([
        { type: 'tool_use', id: 'tc-1', name: 'a', input: {} },
        { type: 'tool_use', id: 'tc-2', name: 'b', input: {} },
      ]),
      toolResultMsg('tc-1', 'a'),
      // tc-2 has no result
    ];

    const result = repairToolUseResultPairing(messages, {
      allowSyntheticToolResults: true,
    });
    const toolResults = result.filter((m: any) => m.role === 'toolResult');
    expect(toolResults).toHaveLength(2);
    expect((toolResults[1] as any).toolCallId).toBe('tc-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -10`
Expected: FAIL — `repairToolUseResultPairing` not exported

- [ ] **Step 3: Implement repairToolUseResultPairing**

Append to `server/providers/replay-transforms.ts`:

```typescript
const SYNTHETIC_TOOL_RESULT_TEXT = '[tool result unavailable]';

export function repairToolUseResultPairing(
  messages: AgentMessage[],
  options?: { allowSyntheticToolResults?: boolean },
): AgentMessage[] {
  // Collect all tool_use IDs from assistant messages
  const toolUseIds = new Set<string>();
  const toolUseInfo = new Map<string, { name: string; afterIndex: number }>();

  for (let i = 0; i < messages.length; i++) {
    const raw = messages[i] as any;
    if (raw.role === 'assistant' && Array.isArray(raw.content)) {
      for (const block of raw.content) {
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          toolUseIds.add(block.id);
          toolUseInfo.set(block.id, { name: block.name ?? 'unknown', afterIndex: i });
        }
      }
    }
  }

  // Collect all toolResult IDs
  const toolResultIds = new Set<string>();
  for (const msg of messages) {
    const raw = msg as any;
    if (raw.role === 'toolResult' && typeof raw.toolCallId === 'string') {
      toolResultIds.add(raw.toolCallId);
    }
  }

  const orphanedUseIds = [...toolUseIds].filter((id) => !toolResultIds.has(id));
  const orphanedResultIds = [...toolResultIds].filter((id) => !toolUseIds.has(id));

  if (orphanedUseIds.length === 0 && orphanedResultIds.length === 0) {
    return messages;
  }

  // Remove orphaned toolResults
  let result = messages.filter((msg) => {
    const raw = msg as any;
    if (raw.role !== 'toolResult') return true;
    return !orphanedResultIds.includes(raw.toolCallId);
  });

  // Insert synthetic results for orphaned tool_use (if allowed)
  if (options?.allowSyntheticToolResults && orphanedUseIds.length > 0) {
    const insertions: Array<{ afterIndex: number; msg: AgentMessage }> = [];

    for (const id of orphanedUseIds) {
      const info = toolUseInfo.get(id);
      if (!info) continue;

      // Find the correct insertion position in the filtered result
      const assistantIndex = result.findIndex(
        (m) => m === messages[info.afterIndex],
      );
      if (assistantIndex === -1) continue;

      insertions.push({
        afterIndex: assistantIndex,
        msg: {
          role: 'toolResult',
          toolCallId: id,
          toolName: info.name,
          content: [{ type: 'text', text: SYNTHETIC_TOOL_RESULT_TEXT }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      });
    }

    // Insert in reverse order to preserve indices
    insertions
      .sort((a, b) => b.afterIndex - a.afterIndex)
      .forEach(({ afterIndex, msg }) => {
        result = [
          ...result.slice(0, afterIndex + 1),
          msg,
          ...result.slice(afterIndex + 1),
        ];
      });
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-transforms.ts server/providers/replay-transforms.test.ts
git commit -m "feat: add tool use/result pairing repair transform"
```

---

### Task 8: Replay Transforms — Turn Ordering Validators

**Files:**
- Modify: `server/providers/replay-transforms.ts`
- Modify: `server/providers/replay-transforms.test.ts`

- [ ] **Step 1: Write tests for turn ordering validators**

Append to `server/providers/replay-transforms.test.ts`:

```typescript
import {
  applyAssistantFirstOrderingFix,
  validateGeminiTurns,
  validateAnthropicTurns,
} from './replay-transforms';

describe('applyAssistantFirstOrderingFix', () => {
  it('returns empty array for empty input', () => {
    expect(applyAssistantFirstOrderingFix([])).toEqual([]);
  });

  it('prepends synthetic user message when assistant is first', () => {
    const messages: AgentMessage[] = [
      assistantMsg([{ type: 'text', text: 'hello' }]),
      userMsg('hi'),
    ];

    const result = applyAssistantFirstOrderingFix(messages);
    expect(result).toHaveLength(3);
    expect((result[0] as any).role).toBe('user');
    expect((result[0] as any).content).toBe('(session bootstrap)');
    expect((result[1] as any).role).toBe('assistant');
  });

  it('does not modify when user is first', () => {
    const messages: AgentMessage[] = [
      userMsg('hi'),
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ];

    const result = applyAssistantFirstOrderingFix(messages);
    expect(result).toEqual(messages);
  });

  it('does not duplicate if bootstrap already present', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: '(session bootstrap)', timestamp: 1 } as AgentMessage,
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ];

    const result = applyAssistantFirstOrderingFix(messages);
    expect(result).toEqual(messages);
  });
});

describe('validateGeminiTurns', () => {
  it('returns empty array for empty input', () => {
    expect(validateGeminiTurns([])).toEqual([]);
  });

  it('inserts synthetic user turn between consecutive assistant turns', () => {
    const messages: AgentMessage[] = [
      userMsg('start'),
      assistantMsg([{ type: 'text', text: 'a' }]),
      assistantMsg([{ type: 'text', text: 'b' }]),
    ];

    const result = validateGeminiTurns(messages);
    expect(result).toHaveLength(4);
    expect((result[2] as any).role).toBe('user');
    expect((result[3] as any).role).toBe('assistant');
  });

  it('does not modify properly alternating messages', () => {
    const messages: AgentMessage[] = [
      userMsg('a'),
      assistantMsg([{ type: 'text', text: 'b' }]),
      userMsg('c'),
      assistantMsg([{ type: 'text', text: 'd' }]),
    ];

    const result = validateGeminiTurns(messages);
    expect(result).toEqual(messages);
  });

  it('treats toolResult as non-assistant for alternation', () => {
    const messages: AgentMessage[] = [
      userMsg('go'),
      assistantMsg([{ type: 'tool_use', id: 'tc-1', name: 'calc', input: {} }]),
      toolResultMsg('tc-1', 'calc'),
      assistantMsg([{ type: 'text', text: 'done' }]),
    ];

    const result = validateGeminiTurns(messages);
    expect(result).toEqual(messages);
  });
});

describe('validateAnthropicTurns', () => {
  it('returns empty array for empty input', () => {
    expect(validateAnthropicTurns([])).toEqual([]);
  });

  it('prepends user message if conversation starts with assistant', () => {
    const messages: AgentMessage[] = [
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ];

    const result = validateAnthropicTurns(messages);
    expect(result).toHaveLength(2);
    expect((result[0] as any).role).toBe('user');
  });

  it('inserts user turn between consecutive assistant messages', () => {
    const messages: AgentMessage[] = [
      userMsg('start'),
      assistantMsg([{ type: 'text', text: 'a' }]),
      assistantMsg([{ type: 'text', text: 'b' }]),
    ];

    const result = validateAnthropicTurns(messages);
    expect(result).toHaveLength(4);
    expect((result[2] as any).role).toBe('user');
  });

  it('does not modify valid Anthropic conversation', () => {
    const messages: AgentMessage[] = [
      userMsg('hi'),
      assistantMsg([{ type: 'text', text: 'hello' }]),
      userMsg('bye'),
    ];

    const result = validateAnthropicTurns(messages);
    expect(result).toEqual(messages);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -10`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement the turn ordering transforms**

Append to `server/providers/replay-transforms.ts`:

```typescript
const SESSION_BOOTSTRAP_TEXT = '(session bootstrap)';
const CONTINUE_TEXT = '(continue)';

export function applyAssistantFirstOrderingFix(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) return messages;

  const first = messages[0] as any;

  // Already has bootstrap
  if (
    first.role === 'user' &&
    typeof first.content === 'string' &&
    first.content.trim() === SESSION_BOOTSTRAP_TEXT
  ) {
    return messages;
  }

  if (first.role !== 'assistant') return messages;

  const bootstrap: AgentMessage = {
    role: 'user',
    content: SESSION_BOOTSTRAP_TEXT,
    timestamp: Date.now(),
  } as AgentMessage;

  return [bootstrap, ...messages];
}

export function validateGeminiTurns(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) return messages;

  const result: AgentMessage[] = [];
  let lastEffectiveRole: string | null = null;

  for (const msg of messages) {
    const role = (msg as any).role;

    if (role === 'assistant' && lastEffectiveRole === 'assistant') {
      // Insert synthetic user turn
      result.push({
        role: 'user',
        content: CONTINUE_TEXT,
        timestamp: Date.now(),
      } as AgentMessage);
    }

    result.push(msg);
    // toolResult counts as non-assistant for alternation purposes
    lastEffectiveRole = role === 'toolResult' ? 'user' : role;
  }

  return result.length === messages.length ? messages : result;
}

export function validateAnthropicTurns(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) return messages;

  const result: AgentMessage[] = [];

  // Ensure conversation starts with user
  if ((messages[0] as any).role === 'assistant') {
    result.push({
      role: 'user',
      content: SESSION_BOOTSTRAP_TEXT,
      timestamp: Date.now(),
    } as AgentMessage);
  }

  let lastRole: string | null = result.length > 0 ? 'user' : null;

  for (const msg of messages) {
    const role = (msg as any).role;
    const effectiveRole = role === 'toolResult' ? 'user' : role;

    if (effectiveRole === 'assistant' && lastRole === 'assistant') {
      result.push({
        role: 'user',
        content: CONTINUE_TEXT,
        timestamp: Date.now(),
      } as AgentMessage);
    }

    result.push(msg);
    lastRole = effectiveRole;
  }

  return result.length === messages.length ? messages : result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-transforms.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-transforms.ts server/providers/replay-transforms.test.ts
git commit -m "feat: add turn ordering validation transforms"
```

---

### Task 9: Replay Normalizer

**Files:**
- Create: `server/providers/replay-normalizer.ts`
- Test: `server/providers/replay-normalizer.test.ts`

- [ ] **Step 1: Write integration tests for the normalizer**

```typescript
// server/providers/replay-normalizer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeReplayHistory } from './replay-normalizer';
import { ProviderPluginRegistry } from './plugin-registry';
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  ProviderReplayPolicy,
  ProviderReplaySessionState,
} from '../../shared/plugin-sdk/replay';

function userMsg(content: string): AgentMessage {
  return { role: 'user', content, timestamp: Date.now() } as AgentMessage;
}

function assistantMsg(content: any[]): AgentMessage {
  return { role: 'assistant', content, timestamp: Date.now() } as AgentMessage;
}

function toolResultMsg(toolCallId: string, toolName: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage;
}

function makePlugin(overrides: Partial<ProviderPluginDefinition> = {}): ProviderPluginDefinition {
  return {
    id: 'test-provider',
    name: 'Test',
    description: 'Test provider',
    runtimeProviderId: 'test',
    defaultBaseUrl: 'https://test.com/api',
    auth: [],
    ...overrides,
  };
}

function makeRegistry(...plugins: ProviderPluginDefinition[]): ProviderPluginRegistry {
  const registry = new ProviderPluginRegistry();
  for (const p of plugins) registry.register(p);
  return registry;
}

describe('normalizeReplayHistory', () => {
  it('returns messages unchanged when no plugin and no modelApi', async () => {
    const messages = [userMsg('hi'), assistantMsg([{ type: 'text', text: 'hello' }])];
    const registry = makeRegistry();

    const result = await normalizeReplayHistory({
      messages,
      provider: 'nonexistent',
      sessionId: 'sess-1',
      registry,
    });

    expect(result).toEqual(messages);
  });

  it('applies plugin buildReplayPolicy', async () => {
    const policy: ProviderReplayPolicy = {
      sanitizeToolCallIds: true,
      toolCallIdMode: 'strict',
    };
    const plugin = makePlugin({
      buildReplayPolicy: () => policy,
    });
    const registry = makeRegistry(plugin);

    const messages: AgentMessage[] = [
      userMsg('go'),
      assistantMsg([
        { type: 'tool_use', id: 'original-123', name: 'calc', input: {} },
      ]),
      toolResultMsg('original-123', 'calc'),
    ];

    const result = await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      sessionId: 'sess-1',
      registry,
    });

    const toolUse = (result[1] as any).content[0];
    expect(toolUse.id).toMatch(/^call_/);
    expect((result[2] as any).toolCallId).toBe(toolUse.id);
  });

  it('applies plugin sanitizeReplayHistory hook', async () => {
    const customSanitizer = vi.fn((ctx) => {
      return ctx.messages.map((m: any) =>
        m.role === 'assistant'
          ? { ...m, content: [{ type: 'text', text: '[sanitized]' }] }
          : m,
      );
    });

    const plugin = makePlugin({
      sanitizeReplayHistory: customSanitizer,
    });
    const registry = makeRegistry(plugin);

    const messages = [userMsg('hi'), assistantMsg([{ type: 'text', text: 'hello' }])];

    const result = await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      sessionId: 'sess-1',
      registry,
    });

    expect(customSanitizer).toHaveBeenCalled();
    expect((result[1] as any).content[0].text).toBe('[sanitized]');
  });

  it('applies plugin validateReplayTurns hook', async () => {
    const customValidator = vi.fn((ctx) => {
      // Just pass through
      return ctx.messages;
    });

    const plugin = makePlugin({
      validateReplayTurns: customValidator,
    });
    const registry = makeRegistry(plugin);

    const messages = [userMsg('hi')];

    await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      sessionId: 'sess-1',
      registry,
    });

    expect(customValidator).toHaveBeenCalled();
  });

  it('falls back to modelApi-based policy when plugin has no hooks', async () => {
    const plugin = makePlugin(); // No replay hooks
    const registry = makeRegistry(plugin);

    const messages: AgentMessage[] = [
      assistantMsg([{ type: 'text', text: 'first' }]),
      userMsg('second'),
    ];

    const result = await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      modelApi: 'openai-completions',
      sessionId: 'sess-1',
      registry,
    });

    // openai-completions policy sets applyAssistantFirstOrderingFix: true
    expect((result[0] as any).role).toBe('user');
    expect((result[0] as any).content).toBe('(session bootstrap)');
  });

  it('drops thinking blocks when policy requires it', async () => {
    const plugin = makePlugin({
      buildReplayPolicy: () => ({ dropThinkingBlocks: true }),
    });
    const registry = makeRegistry(plugin);

    const messages: AgentMessage[] = [
      userMsg('think'),
      assistantMsg([
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Done.' },
      ]),
    ];

    const result = await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      sessionId: 'sess-1',
      registry,
    });

    const content = (result[1] as any).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
  });

  it('recovers gracefully when a transform throws', async () => {
    const plugin = makePlugin({
      buildReplayPolicy: () => {
        throw new Error('Policy build failed');
      },
    });
    const registry = makeRegistry(plugin);

    const messages = [userMsg('hi')];

    const result = await normalizeReplayHistory({
      messages,
      provider: 'test-provider',
      sessionId: 'sess-1',
      registry,
    });

    // Should return original messages on error
    expect(result).toEqual(messages);
  });

  it('handles empty message array', async () => {
    const registry = makeRegistry();

    const result = await normalizeReplayHistory({
      messages: [],
      provider: 'test',
      sessionId: 'sess-1',
      registry,
    });

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/providers/replay-normalizer.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./replay-normalizer` not found

- [ ] **Step 3: Implement the replay normalizer**

```typescript
// server/providers/replay-normalizer.ts

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ProviderPluginRegistry } from './plugin-registry';
import type {
  ProviderReplayPolicy,
  ProviderReplaySessionState,
  ProviderReplaySessionEntry,
} from '../../shared/plugin-sdk/replay';
import {
  sanitizeToolCallIds,
  dropThinkingBlocks,
  sanitizeThoughtSignatures,
  repairToolUseResultPairing,
  applyAssistantFirstOrderingFix,
  validateGeminiTurns,
  validateAnthropicTurns,
} from './replay-transforms';
import {
  buildOpenAICompatibleReplayPolicy,
  buildAnthropicReplayPolicyForModel,
} from './replay-helpers';

export interface NormalizeReplayHistoryParams {
  messages: AgentMessage[];
  provider: string;
  modelId?: string;
  modelApi?: string | null;
  sessionId: string;
  allowedToolNames?: Iterable<string>;
  registry: ProviderPluginRegistry;
}

function createInMemorySessionState(): ProviderReplaySessionState {
  const entries: ProviderReplaySessionEntry[] = [];
  return {
    getCustomEntries: () => entries,
    appendCustomEntry: (customType: string, data: unknown) => {
      entries.push({ customType, data });
    },
  };
}

function resolveReplayPolicy(
  params: NormalizeReplayHistoryParams,
): ProviderReplayPolicy | undefined {
  const plugin = params.registry.get(params.provider);

  // Try plugin hook first
  if (plugin?.buildReplayPolicy) {
    const policy = plugin.buildReplayPolicy({
      provider: params.provider,
      modelId: params.modelId,
      modelApi: params.modelApi,
    });
    if (policy) return policy;
  }

  // Fallback: derive from modelApi
  if (params.modelApi === 'anthropic-messages') {
    return buildAnthropicReplayPolicyForModel(params.modelId);
  }
  return buildOpenAICompatibleReplayPolicy(params.modelApi);
}

function applyGenericSanitization(
  messages: AgentMessage[],
  policy: ProviderReplayPolicy,
): AgentMessage[] {
  let result = messages;

  if (policy.sanitizeToolCallIds && policy.toolCallIdMode) {
    result = sanitizeToolCallIds(result, policy.toolCallIdMode, {
      preserveNativeAnthropicToolUseIds: policy.preserveNativeAnthropicToolUseIds,
    });
  }

  if (policy.dropThinkingBlocks) {
    result = dropThinkingBlocks(result);
  }

  if (policy.sanitizeThoughtSignatures) {
    result = sanitizeThoughtSignatures(result, policy.sanitizeThoughtSignatures);
  }

  if (policy.repairToolUseResultPairing) {
    result = repairToolUseResultPairing(result, {
      allowSyntheticToolResults: policy.allowSyntheticToolResults,
    });
  }

  return result;
}

function applyTurnValidation(
  messages: AgentMessage[],
  policy: ProviderReplayPolicy,
): AgentMessage[] {
  let result = messages;

  if (policy.applyAssistantFirstOrderingFix) {
    result = applyAssistantFirstOrderingFix(result);
  }

  if (policy.validateGeminiTurns) {
    result = validateGeminiTurns(result);
  }

  if (policy.validateAnthropicTurns) {
    result = validateAnthropicTurns(result);
  }

  return result;
}

export async function normalizeReplayHistory(
  params: NormalizeReplayHistoryParams,
): Promise<AgentMessage[]> {
  if (params.messages.length === 0) return params.messages;

  try {
    // 1. Resolve replay policy
    const policy = resolveReplayPolicy(params);
    if (!policy) return params.messages;

    // 2. Generic sanitization based on policy flags
    let messages = applyGenericSanitization(params.messages, policy);

    // 3. Provider-specific sanitization via plugin hook
    const plugin = params.registry.get(params.provider);
    if (plugin?.sanitizeReplayHistory) {
      const sessionState = createInMemorySessionState();
      const sanitized = await plugin.sanitizeReplayHistory({
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.modelApi,
        sessionId: params.sessionId,
        messages,
        allowedToolNames: params.allowedToolNames,
        sessionState,
      });
      if (sanitized) {
        messages = sanitized;
      }
    }

    // 4. Turn validation
    if (plugin?.validateReplayTurns) {
      const sessionState = createInMemorySessionState();
      const validated = await plugin.validateReplayTurns({
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.modelApi,
        sessionId: params.sessionId,
        messages,
        sessionState,
      });
      if (validated) {
        messages = validated;
      }
    } else {
      messages = applyTurnValidation(messages, policy);
    }

    return messages;
  } catch (err) {
    console.warn('[ReplayNormalizer] normalization failed, using raw transcript', {
      provider: params.provider,
      modelId: params.modelId,
      sessionId: params.sessionId,
      error: err,
    });
    return params.messages;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/providers/replay-normalizer.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/providers/replay-normalizer.ts server/providers/replay-normalizer.test.ts
git commit -m "feat: add replay normalizer pipeline with plugin hooks and fallback"
```

---

### Task 10: Wire Normalizer into RunCoordinator

**Files:**
- Modify: `server/agents/run-coordinator.ts:1-10, 96-128, 441-444`
- Modify: `server/agents/agent-manager.ts:91-95`

- [ ] **Step 1: Add pluginRegistry parameter to RunCoordinator**

In `server/agents/run-coordinator.ts`, add the import at line 1 area:

```typescript
import type { ProviderPluginRegistry } from '../providers/plugin-registry';
import { normalizeReplayHistory } from '../providers/replay-normalizer';
```

Modify the constructor (around line 108) to accept the registry:

```typescript
  constructor(
    private readonly agentId: string,
    private readonly runtime: AgentRuntime,
    private readonly config: AgentConfig,
    private readonly storage: StorageEngine | null,
    private readonly hooks: HookRegistry | null = null,
    sessionRouter?: SessionRouter,
    transcriptStore?: SessionTranscriptStore,
    private readonly pluginRegistry?: ProviderPluginRegistry,
  ) {
```

- [ ] **Step 2: Call normalizeReplayHistory before setSessionContext**

Replace lines 441-444 in `server/agents/run-coordinator.ts`:

```typescript
      // Before:
      this.runtime.setSessionContext(
        transcriptManager.buildSessionContext().messages as AgentMessage[],
      );
```

With:

```typescript
      let sessionMessages = transcriptManager.buildSessionContext().messages as AgentMessage[];
      if (this.pluginRegistry) {
        sessionMessages = await normalizeReplayHistory({
          messages: sessionMessages,
          provider: this.config.provider.pluginId,
          modelId: this.config.modelId,
          modelApi: undefined, // modelApi not yet tracked on AgentConfig
          sessionId: record.sessionId,
          registry: this.pluginRegistry,
        });
      }
      this.runtime.setSessionContext(sessionMessages);
```

- [ ] **Step 3: Pass pluginRegistry from AgentManager to RunCoordinator**

In `server/agents/agent-manager.ts`, update the `RunCoordinator` construction (line 95):

```typescript
    // Before:
    const coordinator = new RunCoordinator(config.id, runtime, config, storage, hooks);

    // After:
    const coordinator = new RunCoordinator(
      config.id, runtime, config, storage, hooks,
      undefined, undefined, this.pluginRegistry,
    );
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Run existing run-coordinator tests to verify no regressions**

Run: `npx vitest run server/agents/run-coordinator.test.ts 2>&1 | tail -15`
Expected: All existing tests PASS (the new parameter is optional, so existing constructor calls still work)

- [ ] **Step 6: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/agent-manager.ts
git commit -m "feat: wire replay normalizer into run coordinator pipeline"
```

---

### Task 11: Update OpenRouter Plugin with Replay Hooks

**Files:**
- Modify: `server/providers/plugins/openrouter.ts`

- [ ] **Step 1: Add replay family hooks to OpenRouter plugin**

In `server/providers/plugins/openrouter.ts`, add the import:

```typescript
import { buildProviderReplayFamilyHooks } from '../../../shared/plugin-sdk/replay-family';
```

Create the hooks before the plugin definition:

```typescript
const PASSTHROUGH_GEMINI_REPLAY_HOOKS = buildProviderReplayFamilyHooks({
  family: 'passthrough-gemini',
});
```

Then spread them into the plugin definition (after `streamFamily: 'openrouter-thinking'`):

```typescript
export const openrouterPlugin = definePluginEntry({
  // ... existing fields ...
  streamFamily: 'openrouter-thinking',
  ...PASSTHROUGH_GEMINI_REPLAY_HOOKS,
  resolveReasoningOutputMode: () => 'native',
});
```

Note: `resolveReasoningOutputMode: () => 'native'` overrides the one from the spread (passthrough-gemini doesn't set one), matching the OpenClaw reference exactly.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/providers/plugins/openrouter.ts
git commit -m "feat: add passthrough-gemini replay hooks to OpenRouter plugin"
```

---

### Task 12: Full Integration Test Run

**Files:** None (verification only)

- [ ] **Step 1: Run all replay-related tests**

Run: `npx vitest run server/providers/replay-helpers.test.ts server/providers/replay-transforms.test.ts server/providers/replay-normalizer.test.ts shared/plugin-sdk/replay-family.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 2: Run full test suite to check for regressions**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit any fixes if needed**

If any tests or type errors were found, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve test/type issues from replay normalization integration"
```
