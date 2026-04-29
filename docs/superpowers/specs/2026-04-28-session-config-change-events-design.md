# Session Config Change Events Design

**Date:** 2026-04-28
**Scope:** Persist per-session model and thinking-level changes as discrete transcript events plus a run-time `model-snapshot`, with `SessionStoreEntry` kept as a mirrored cache for fast resume.
**Deferred:** Typed events for `verboseLevel`, `reasoningLevel`, `elevatedLevel`, `sendPolicy`, `authProfileOverride`. Same pattern, follow-up spec.

## Overview

When the user changes the model or thinking level from the chat drawer, the change must be saved in the session — visible in the JSONL transcript, recoverable on resume, and surfaceable in audit/history views. Today the `SessionStoreEntry` schema already has `modelOverride` / `providerOverride` / `thinkingLevel` fields, but no code path writes them in response to a chat-drawer toggle, and the transcript carries no record that a change happened.

This spec adds two new typed transcript entries, a custom `model-snapshot`, and the wiring so toggles persist atomically into both the transcript and the existing flat fields.

### Goals

- Every model / thinking-level toggle from the chat drawer produces a typed delta event in the JSONL.
- Every run records a `model-snapshot` with the server-resolved `{provider, modelApi, modelId}` *only* when that resolved tuple changes from the prior snapshot.
- `SessionStoreEntry.modelOverride` / `providerOverride` / `thinkingLevel` reflect the latest committed values so the chat drawer renders the current config in one read on session open.
- Same-value toggles and unchanged-snapshot runs do not pollute the transcript.

### Architecture

```
Chat drawer toggle
  -> WS: session:set-config { sessionKey, change }
    -> SessionRouter.recordConfigChange()
       1. Drop if change.value == current mirrored value
       2. Append typed entry (model_change | thinking_level_change) to JSONL
       3. Update mirrored field on SessionStoreEntry (sessions.json)
       4. Broadcast updated session status

User sends a message
  -> RunCoordinator.dispatch()
     1. Resolve effective {provider, modelApi, modelId}
     2. Read last 'model-snapshot' from transcript (if any)
     3. If resolved tuple differs, append a custom 'model-snapshot' entry
     4. Continue normal run lifecycle
```

| Component | Owns | Does not own |
|-----------|------|--------------|
| **Client (chat drawer)** | UI controls, WS dispatch on toggle, reading mirrored fields on open | Transcript I/O, config resolution |
| **SessionRouter** | Toggle → typed-entry write, mirror update, idempotency check, status broadcast | Snapshot writes, model resolution |
| **RunCoordinator** | `model-snapshot` writes at dispatch, snapshot idempotency check | Toggle handling, mirror updates |

## Transcript entry types

Three new entries, all linked into the existing parent-chain via `parentId` set to the current leaf entry of the transcript at write time.

### `model_change`

```json
{
  "type": "model_change",
  "id": "<nanoid>",
  "parentId": "<previous-leaf-id|null>",
  "timestamp": "<ISO-8601>",
  "provider": "openrouter",
  "modelId": "xiaomi/mimo-v2-pro"
}
```

A single `model_change` carries provider and model together. The chat drawer's model picker selects them as a pair, and the resolved provider plugin is determined by the model choice — splitting them would let an inconsistent intermediate state hit the transcript.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "<nanoid>",
  "parentId": "<previous-leaf-id>",
  "timestamp": "<ISO-8601>",
  "thinkingLevel": "low"
}
```

`thinkingLevel` is one of the documented values for the agent (`off | low | medium | high` or whatever the agent's provider permits). Validation lives in the resolver layer that already exists; this spec does not add new validation.

### `custom` `model-snapshot`

```json
{
  "type": "custom",
  "customType": "model-snapshot",
  "id": "<nanoid>",
  "parentId": "<previous-leaf-id>",
  "timestamp": "<ISO-8601>",
  "data": {
    "timestamp": 1774362588813,
    "provider": "openrouter",
    "modelApi": "openai-completions",
    "modelId": "xiaomi/mimo-v2-pro"
  }
}
```

The snapshot captures the *server-resolved* config that will actually be sent to the LLM, including the API protocol (`modelApi`) which is not present in `model_change`. This is the entry used by replay / audit views to reconstruct what the model received, separate from what the user clicked.

## Mirror — `SessionStoreEntry`

No schema change. The existing fields are populated:

| Event | Mirror fields updated |
|---|---|
| `model_change` | `providerOverride = provider`, `modelOverride = modelId` |
| `thinking_level_change` | `thinkingLevel = thinkingLevel` |

The mirror is the chat drawer's source of truth for "current effective config" on session resume. Transcript walks are reserved for history / audit views.

Mirror writes happen *after* the transcript append succeeds, and within the same async handler. If the transcript append throws, the mirror is not updated and the toggle surfaces an error to the UI — both stay consistent or both are unchanged.

## Write triggers

### Per-toggle (immediate)

Each individual toggle from the chat drawer fires its own WS message. There is no client-side batching. The router's same-value drop is the only deduplication. This was chosen over send-time batching because:

- The drawer might display "current model: X" the moment the toggle moves; immediate writes mean the rendered value is what's actually persisted.
- Toggle-and-revert noise is already eliminated by the same-value drop in the router (a re-click of the current value is a no-op).
- Implementation is simpler — no buffer state, no flush ordering against message send.

### Per-run (snapshot)

The snapshot is written inside `RunCoordinator.dispatch()`, after model resolution and before the model is invoked. Idempotency check: read the most recent `custom`/`customType: 'model-snapshot'` entry from the transcript; if `data.{provider, modelApi, modelId}` matches the resolved tuple, skip the write.

A snapshot is always written when none has been written yet for the session — i.e., the first run after session creation, or any run that follows a config change since the last snapshot.

## Edge cases

- **Same-value toggles.** Dropped in `SessionRouter.recordConfigChange` before any transcript I/O.
- **Snapshot unchanged.** Skipped in `RunCoordinator.dispatch` after reading the latest snapshot.
- **Reset / clear.** Reset wipes counters and creates a fresh transcript. The mirrored override fields on the new `SessionStoreEntry` carry through unchanged. The first run on the fresh transcript will write a `model-snapshot` (because the new transcript has no prior snapshot), making the cleared session self-describing.
- **Branch.** A branched transcript starts from the parent's leaf. The branch's mirrored fields are copied. The branch's first run writes a fresh `model-snapshot` (same reason as reset). Discrete `model_change` / `thinking_level_change` entries are *not* re-emitted at the fork — readers walking the branch backward find them in the parent transcript via the existing branch-history machinery.
- **Failed transcript append.** Mirror is not updated. The WS reply carries an error; the chat drawer reverts the control to its prior value.
- **Concurrent toggles.** `SessionRouter` already serializes per-session writes; toggles are processed in arrival order. The mirror reflects the last applied event.

## Out of scope

- Typed events for `verboseLevel`, `reasoningLevel`, `elevatedLevel`, `sendPolicy`, `authProfileOverride`. The same pattern applies; deferred to keep this change small. Adding them later requires: a new entry type per knob, a new branch in `recordConfigChange`, and (optionally) the snapshot capturing them.
- A history / audit UI that walks the transcript and renders config-change deltas as a timeline. The events are written; presentation is a separate spec.
- Buffered / batched UI flushes. Rejected per the trade-off above.
- Retroactive backfill of `model_change` events for existing sessions. Sessions created before this lands have no events in the transcript; the mirror still answers "current config" correctly because it was being maintained by the existing override-write paths (or, where it wasn't, it falls back to agent defaults).

## Open questions resolved during brainstorm

- *Provider as separate event?* No — bundled with `model_change` because the picker pairs them.
- *Source of truth on resume?* Mirrored. Transcript is audit / replay; `SessionStoreEntry` is what the UI reads on open.
- *Write timing?* Per-toggle, with same-value drop. Snapshot per-run, with unchanged-tuple skip.
