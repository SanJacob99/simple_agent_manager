# Agent Custom Model Discovery Design

Date: 2026-04-01
Status: Draft approved in conversation, written for review

## Summary

Add support for provider-supported model IDs that are not present in the app's built-in model list, such as `xiaomi/mimo-v2-pro` on OpenRouter.

This change keeps the existing provider picker, adds a `Custom model...` path in the Agent node's `Model` field, introduces provider-backed model discovery for OpenRouter, and stores model capability overrides per agent so users are not blocked by stale or incomplete discovered metadata.

## Goals

- Allow an agent to use a valid provider model that is missing from the app's static model list.
- Preserve the current simple picker flow for built-in models.
- Fetch model metadata from OpenRouter when an OpenRouter API key is available.
- Use discovered metadata as defaults, not as locked configuration.
- Allow per-agent overrides for model capabilities and runtime-relevant limits.
- Keep the runtime working when discovery is unavailable or incomplete.
- Leave a clear path for future custom provider + custom model support.

## Non-Goals

- Do not add first-class custom provider support in this change.
- Do not implement provider discovery for every provider in this change.
- Do not require discovery to succeed before an agent can run.
- Do not treat discovered metadata as authoritative or immutable.

## Current Constraints

- The Agent properties editor currently uses a static provider list and a static `MODELS` map.
- `modelId` is stored directly on the Agent node.
- Runtime creation currently calls `getModel(provider, modelId)` from `@mariozechner/pi-ai`.
- `pi-ai` only resolves models that exist in its internal model registry. Unknown model IDs return `undefined`.
- Settings currently store API keys by fixed provider name only.

These constraints mean a UI-only change would not be sufficient. Unknown model IDs need runtime fallback behavior, and model discovery needs a cache/store separate from the static list.

## User Experience

### Provider Field

- Keep the existing provider select.
- Do not add custom provider support in this iteration.

### Model Field

- Keep the existing `Model` select.
- Show built-in static model options immediately.
- Merge in discovered provider models when available.
- Append a `Custom model...` option.

### Custom Model Behavior

- Selecting `Custom model...` reveals a text input under the select.
- The text input writes the real `modelId` value, for example `xiaomi/mimo-v2-pro`.
- The editor derives whether it is in custom mode by checking whether `modelId` exists in the currently available built-in/discovered model list.
- The app does not persist a separate `isCustomModel` flag.

### Provider Change Behavior

- When the provider changes, reset `modelId` to that provider's first built-in model.
- Exit custom mode on provider change.

This matches the approved UX choice and avoids carrying incompatible provider/model combinations across provider switches.

## Discovery Behavior

### OpenRouter Discovery Trigger

- On app startup, if an OpenRouter API key already exists, fetch OpenRouter model metadata.
- When the OpenRouter API key is newly added, fetch OpenRouter model metadata.
- When the OpenRouter API key changes, invalidate cached OpenRouter metadata and refetch.

### OpenRouter Endpoint

- Fetch from `GET https://openrouter.ai/api/v1/models`.
- Use the configured OpenRouter API key in the request.

### Discovery Failure Behavior

- If discovery fails, the Agent editor still functions with:
  - built-in static model options
  - `Custom model...`
- Discovery failure must not block runtime usage of manually entered model IDs.

## Capability Model

Discovered metadata should seed defaults, not lock configuration.

### Per-Agent Capability Settings

Add per-agent model capability configuration on the Agent node. These values are runtime-relevant and user-editable:

- `reasoningSupported`
- `inputModalities`
- `contextWindow`
- `maxTokens`
- `cost`

These settings live on the Agent node so different agents can intentionally use the same provider/model with different runtime assumptions.

### Override Semantics

Resolved runtime capabilities should use:

1. Agent-level override
2. Discovered provider metadata for the selected model
3. Provider template fallback

### Why This Matters

- A discovered model may advertise reasoning support, but the user may need to disable or adjust usage for a specific agent.
- A provider may expose image input, but an agent configuration may deliberately limit itself to text.
- Provider metadata can be incomplete, stale, or mapped imperfectly into the app's runtime model shape.

The user must not be stuck with provider-discovered defaults they cannot change.

## Discovery Data Mapping

For OpenRouter, use the fetched metadata to populate defaults when available:

- `context_length` -> `contextWindow`
- `top_provider.max_completion_tokens` -> `maxTokens`
- `pricing` -> `cost`
- `architecture.input_modalities` -> `inputModalities`
- `supported_parameters` and related metadata -> best-effort `reasoningSupported`

### Important Consideration

Reasoning support does not map perfectly to the app's existing `thinkingLevel`. `reasoningSupported` is a capability flag. `thinkingLevel` remains the requested behavior. Runtime logic must treat them separately.

## Data Model Changes

### Agent Node

Extend `AgentNodeData` to store:

- the selected `provider`
- the selected `modelId`
- a per-agent capability override object

The override object should allow individual fields to be absent so the app can distinguish:

- no override, use discovered/default value
- explicit override, use agent-specific value

### Discovery Cache

Add a dedicated client-side store/cache for discovered provider models and metadata.

This store should:

- keep discovered model metadata per provider
- track loading and error state
- support invalidation when an API key changes
- be readable by both the Agent editor and runtime model resolution

The cache should not be stored inside Agent node data, because discovered metadata is provider-wide shared context, not agent-specific authored state.

## Runtime Resolution

### Resolution Order

When creating the runtime model object:

1. Try `pi-ai` built-in `getModel(provider, modelId)`.
2. If found, use it as the base model.
3. If not found, check discovered provider metadata.
4. If discovered metadata exists, synthesize a `Model` object from that metadata plus provider transport defaults.
5. If neither built-in nor discovered metadata exists, synthesize a last-resort provider-template model so manually entered model IDs can still run.

### Provider Template Fallback

Fallback synthesis should copy transport and compatibility details from a known built-in model for the same provider, then replace model-specific fields.

This should preserve:

- `api`
- `provider`
- `baseUrl`
- compatibility settings

It should then fill model fields from discovery if present, or conservative provider defaults otherwise.

### Runtime Safety

- Unknown custom IDs may still be rejected by the upstream provider. That should surface as a provider/runtime error.
- The app's responsibility is to make valid provider-supported custom IDs possible, not to guarantee a user-typed model exists upstream.

## Settings Integration

Settings are no longer only passive key storage for OpenRouter.

When the OpenRouter key changes:

- invalidate cached OpenRouter model metadata
- trigger a fresh metadata fetch
- expose loading/error state so the rest of the app can react without blocking

This change should be implemented in a way that keeps the Settings UI responsive and does not require users to manually refresh the page.

## UI Notes

### Agent Properties

The Agent properties editor should:

- show built-in and discovered models in the `Model` select
- expose `Custom model...`
- show a helper text explaining that a provider-supported model ID can be entered manually
- expose the per-agent capability fields in a way that makes it clear they are editable defaults/overrides

### Capability Editing

Capability controls should not imply that discovery is authoritative.

Recommended UX approach:

- show discovered/default values
- allow the user to override them directly
- make it clear when a field is using a default versus a custom override

## Error Handling

- No OpenRouter key:
  - do not fetch
  - use built-in models plus `Custom model...`
- Discovery fetch fails:
  - keep existing editor usable
  - surface non-blocking error state
- Discovery returns partial metadata:
  - use partial discovered values
  - fall back per-field for anything missing
- User enters an invalid custom model ID:
  - allow configuration
  - surface runtime/provider error if execution fails

## Testing Strategy

The risky behavior is model resolution and metadata merge logic, not the select control itself.

Recommended coverage:

- unit tests for capability resolution order:
  - agent override wins
  - discovered metadata fills missing values
  - provider fallback fills final gaps
- unit tests for custom-mode derivation in the Agent editor
- unit tests for provider-change reset behavior
- unit tests for discovery cache invalidation when the OpenRouter API key changes
- runtime tests for:
  - built-in known model path
  - discovered unknown model path
  - manual custom model fallback path

If test infrastructure is not already present, it may be reasonable to add a minimal setup focused on runtime/model resolution utilities, because that is where this feature is most likely to regress.

## Implementation Outline

1. Add provider discovery store/cache for OpenRouter metadata and refresh behavior.
2. Extend Settings-triggered flows so OpenRouter key changes invalidate and refetch discovery data.
3. Extend `AgentNodeData` with per-agent capability override fields.
4. Update Agent properties UI to:
   - merge built-in and discovered models
   - support `Custom model...`
   - show/edit per-agent capability overrides
5. Extract runtime model resolution into a helper that supports:
   - built-in models
   - discovered models
   - provider-template fallback
6. Update runtime creation to use the new resolver.
7. Add tests for resolution and editor behavior.

## Risks

- Mapping provider metadata into `pi-ai`'s `Model` shape may be lossy, especially for reasoning semantics.
- Discovery triggered from Settings introduces shared state between configuration and runtime behavior.
- If override semantics are not explicit, later discovery refreshes could accidentally overwrite user intent.

The design avoids the largest risk by keeping agent-authored overrides separate from provider-discovered defaults.

## Backlog / TODO

Future work: support `custom provider + custom model`.

Expected scope for that future feature:

- custom provider entry in the Agent UI
- provider base URL
- API compatibility mode selection
- API key storage for dynamic providers
- optional model discovery for custom providers
- provider-specific header/config support as needed

This is intentionally out of scope for the current change.
