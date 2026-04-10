# Provider Replay Normalization Design

> **Date:** 2026-04-10
> **Status:** Approved
> **Builds on:** Provider Plugin SDK (`docs/superpowers/specs/2026-04-09-provider-plugin-sdk-design.md`)
> **Reference:** OpenClaw replay system (`notes/inspo/openclaw/src/plugins/provider-replay-helpers.ts`, `notes/inspo/openclaw/src/plugin-sdk/provider-model-shared.ts`)

## Problem

Different LLM providers have different requirements for how conversation history is formatted when replayed in subsequent turns. Tool call IDs, turn ordering, thinking block handling, and message structure vary across OpenAI-compatible, Anthropic Messages, and Google Gemini APIs. Without normalization, cross-provider replays fail or produce degraded results.

SAM needs a proactive normalization layer so that when new providers are added beyond OpenRouter, each one works correctly without per-provider hacks in the run coordinator.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How replay hooks are wired | Explicit hook functions on `ProviderPluginDefinition` | Matches OpenClaw's approach; maximum control per plugin |
| When normalization is applied | At prompt time, before sending to provider | Stored transcript stays canonical; normalization is ephemeral |
| Provider switches mid-conversation | Best-effort, graceful degradation | Log warnings but don't block; accept fidelity loss |
| Relationship to stream wrapping | Separate concerns | `streamFamily`/`wrapStreamFn` stays for live streams; replay hooks are independent |
| Design approach | Direct port of OpenClaw's replay system | Battle-tested, covers all known edge cases |

## Architecture

### Layer 1: Core Types (`shared/plugin-sdk/replay.ts`)

New shared types that both server and (potentially) client can reference.

```typescript
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

### Layer 2: Plugin Definition Extensions (`shared/plugin-sdk/types.ts`)

Four new optional hooks added to `ProviderPluginDefinition`:

```typescript
buildReplayPolicy?: (ctx: ProviderReplayPolicyContext) =>
  ProviderReplayPolicy | null | undefined;

sanitizeReplayHistory?: (ctx: ProviderSanitizeReplayHistoryContext) =>
  Promise<AgentMessage[] | null | undefined> | AgentMessage[] | null | undefined;

validateReplayTurns?: (ctx: ProviderValidateReplayTurnsContext) =>
  Promise<AgentMessage[] | null | undefined> | AgentMessage[] | null | undefined;

resolveReasoningOutputMode?: (ctx: ProviderReasoningOutputModeContext) =>
  ProviderReasoningOutputMode | null | undefined;
```

### Layer 3: Replay Family Helper (`shared/plugin-sdk/replay-family.ts`)

Convenience helper so plugins can opt into a preset family without writing custom hooks:

```typescript
type ProviderReplayFamilyHooks = Pick<
  ProviderPluginDefinition,
  'buildReplayPolicy' | 'sanitizeReplayHistory' | 'resolveReasoningOutputMode'
>;

type BuildProviderReplayFamilyHooksOptions =
  | { family: 'openai-compatible' }
  | { family: 'anthropic-by-model' }
  | { family: 'google-gemini' }
  | { family: 'passthrough-gemini' }
  | { family: 'hybrid-anthropic-openai'; anthropicModelDropThinkingBlocks?: boolean };

export function buildProviderReplayFamilyHooks(
  options: BuildProviderReplayFamilyHooksOptions
): ProviderReplayFamilyHooks;
```

### Layer 4: Replay Policy Builders (`server/providers/replay-helpers.ts`)

Pre-built policy constructors ported from OpenClaw's `provider-replay-helpers.ts`:

- `buildOpenAICompatibleReplayPolicy(modelApi)` — tool call ID strict mode, assistant-first fix for completions
- `buildStrictAnthropicReplayPolicy(options?)` — full sanitize, signature preservation, turn validation
- `buildAnthropicReplayPolicyForModel(modelId?)` — delegates to strict with thinking block handling based on model version
- `buildNativeAnthropicReplayPolicyForModel(modelId?)` — same but preserves native Anthropic tool use IDs
- `buildGoogleGeminiReplayPolicy()` — full sanitize, thought signature cleanup, turn ordering, synthetic results
- `buildPassthroughGeminiSanitizingReplayPolicy(modelId?)` — minimal, only thought signatures for gemini models
- `buildHybridAnthropicOrOpenAIReplayPolicy(ctx, options?)` — delegates based on `modelApi`
- `shouldPreserveThinkingBlocks(modelId?)` — true for Claude 4.5+
- `sanitizeGoogleGeminiReplayHistory(ctx)` — assistant-first bootstrap with session state tracking
- `resolveTaggedReasoningOutputMode()` — returns `'tagged'`

### Layer 5: Sanitization Transforms (`server/providers/replay-transforms.ts`)

Pure functions implementing each policy flag:

| Function | Policy Flag | Behavior |
|----------|-------------|----------|
| `sanitizeToolCallIds(messages, mode, options?)` | `sanitizeToolCallIds`, `toolCallIdMode` | Regenerate tool call IDs in deterministic format; maintain mapping so tool_result references stay consistent |
| `dropThinkingBlocks(messages)` | `dropThinkingBlocks` | Strip thinking content blocks from assistant messages |
| `sanitizeThoughtSignatures(messages, options)` | `sanitizeThoughtSignatures` | Clean signature fields on thinking blocks |
| `repairToolUseResultPairing(messages, options?)` | `repairToolUseResultPairing` | Insert synthetic results for orphaned tool_use; remove orphaned tool_result |
| `applyAssistantFirstOrderingFix(messages)` | `applyAssistantFirstOrderingFix` | Prepend synthetic user message if assistant speaks first |
| `validateGeminiTurns(messages)` | `validateGeminiTurns` | Enforce user/assistant alternation, merge consecutive same-role |
| `validateAnthropicTurns(messages)` | `validateAnthropicTurns` | Ensure user-first, no consecutive assistant turns |

All transforms are stateless and side-effect free.

### Layer 6: Replay Normalizer (`server/providers/replay-normalizer.ts`)

Main entry point called by the run coordinator at prompt time:

```typescript
export async function normalizeReplayHistory(params: {
  messages: AgentMessage[];
  provider: string;
  modelId?: string;
  modelApi?: string | null;
  sessionId: string;
  sessionManager: SessionManager;
  allowedToolNames?: Iterable<string>;
  registry: ProviderPluginRegistry;
}): Promise<AgentMessage[]>
```

**Execution pipeline:**

1. **Resolve replay policy** — call `plugin.buildReplayPolicy(ctx)`, fall back to `modelApi`-derived policy
2. **Generic sanitization** — apply transforms based on policy flags (tool call IDs, thinking blocks, thought signatures, tool use pairing)
3. **Provider-specific sanitization** — call `plugin.sanitizeReplayHistory(ctx)` if defined, with `ProviderReplaySessionState` adapter wrapping session manager
4. **Turn validation** — call `plugin.validateReplayTurns(ctx)` if defined, else apply generic validators from policy flags
5. **Return normalized messages**

### Integration Point (`server/agents/run-coordinator.ts`)

```
// Current flow:
transcript -> openSession -> buildSessionContext -> setSessionContext -> prompt

// New flow:
transcript -> openSession -> buildSessionContext
  -> normalizeReplayHistory(messages, plugin, modelId, modelApi, ...)
  -> setSessionContext(normalizedMessages) -> prompt
```

Stored transcript is never modified. Normalization is ephemeral, applied fresh each turn.

### OpenRouter Plugin Update (`server/providers/plugins/openrouter.ts`)

```typescript
const REPLAY_HOOKS = buildProviderReplayFamilyHooks({
  family: 'passthrough-gemini',
});

export const openrouterPlugin: ProviderPluginDefinition = {
  // ... existing fields ...
  ...REPLAY_HOOKS,
  resolveReasoningOutputMode: () => 'native',
};
```

### Fallback Strategy

When a plugin doesn't define `buildReplayPolicy`, the normalizer derives a minimal policy from `modelApi`:

| `modelApi` | Fallback Policy |
|------------|----------------|
| `'openai-completions'` | `buildOpenAICompatibleReplayPolicy('openai-completions')` |
| `'anthropic-messages'` | `buildAnthropicReplayPolicyForModel(modelId)` |
| Other / undefined | No normalization (passthrough) |

## Error Handling

Replay normalization is best-effort. If any transform throws, the normalizer catches the error, logs a warning, and returns the original un-normalized messages. Individual transforms are wrapped independently so a failing `sanitizeToolCallIds` doesn't prevent `validateGeminiTurns` from running.

Cross-provider replay (e.g. messages stored from Anthropic replayed through OpenAI) applies the current provider's policy to the entire history. Content types that can't be translated are stripped rather than causing errors.

## Files

### New Files

| File | Responsibility |
|------|---------------|
| `shared/plugin-sdk/replay.ts` | Core replay types: `ProviderReplayPolicy`, contexts, families |
| `shared/plugin-sdk/replay-family.ts` | `buildProviderReplayFamilyHooks()` convenience helper |
| `server/providers/replay-helpers.ts` | Pre-built policy constructors per provider family |
| `server/providers/replay-transforms.ts` | Pure transform functions (tool call IDs, thinking blocks, turn ordering, etc.) |
| `server/providers/replay-normalizer.ts` | Main normalizer entry point, pipeline orchestration |
| `server/providers/__tests__/replay-transforms.test.ts` | Transform function unit tests |
| `server/providers/__tests__/replay-helpers.test.ts` | Policy builder tests |
| `server/providers/__tests__/replay-normalizer.test.ts` | Integration tests with mock plugins |
| `shared/plugin-sdk/__tests__/replay-family.test.ts` | Family hooks helper tests |

### Modified Files

| File | Change |
|------|--------|
| `shared/plugin-sdk/types.ts` | Add four optional hooks to `ProviderPluginDefinition` |
| `shared/plugin-sdk/index.ts` | Re-export from `replay.ts` and `replay-family.ts` |
| `server/providers/plugins/openrouter.ts` | Spread replay family hooks, add `resolveReasoningOutputMode` |
| `server/agents/run-coordinator.ts` | Call `normalizeReplayHistory()` before `setSessionContext()` |

## Testing

| Test File | Coverage |
|-----------|----------|
| `server/providers/__tests__/replay-transforms.test.ts` | Each transform in isolation: tool call ID rewrite, thinking block drop, pairing repair, turn validation, assistant-first fix |
| `server/providers/__tests__/replay-helpers.test.ts` | Policy builders return correct flags per family; `shouldPreserveThinkingBlocks` model matching for Claude 3.x vs 4.5+ |
| `server/providers/__tests__/replay-normalizer.test.ts` | Full pipeline with mock plugin hooks; fallback to modelApi-based policy; error recovery; cross-provider replay; empty messages |
| `shared/plugin-sdk/__tests__/replay-family.test.ts` | `buildProviderReplayFamilyHooks` returns correct hook shape for each family |

<!-- last-verified: 2026-04-10 -->
