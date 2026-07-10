# Memory Node

> Two-tier persistent memory for an agent. Inspired by OpenClaw: a single durable `MEMORY.md` plus per-day short-term logs, both saved alongside the agent's sessions on disk.

<!-- source: src/types/nodes.ts#MemoryNodeData -->
<!-- last-verified: 2026-07-10 -->

## Overview

The Memory Node gives an agent a place to remember facts about **the job it
is supposed to do** and **the user it's working with**. The model mirrors
OpenClaw's two-tier design:

- **Long-term memory** — a single `MEMORY.md` file holding durable facts:
  user preferences, role, project decisions, standing instructions. Loaded at
  session start and never auto-compacted.
- **Short-term memory** — one Markdown file per day at
  `memory/YYYY-MM-DD.md`, used to log observations and context from the
  current session. Recent days are auto-loaded; older days can be compacted.

Persistence is delegated to the connected **Storage** node. Without a
Storage node the memory engine is constructed but every tool returns
`Memory is offline`. The same files are surfaced under `<agentDir>/memory/`
so the user can audit, edit, or version-control them outside the app.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Memory"` | Display label on the canvas |
| `autoLoadLongTerm` | `boolean` | `true` | Inject `MEMORY.md` into the system prompt at session start |
| `longTermMaxBytes` | `number` | `8000` | Cap on injected `MEMORY.md` size. `0` = no cap |
| `autoLoadShortTermDays` | `number` | `2` | How many recent daily logs to inject (today counts as 1) |
| `compactionEnabled` | `boolean` | `false` | Periodically compact old daily logs |
| `compactionAfterDays` | `number` | `7` | Daily logs older than this become compaction candidates |
| `compactionStrategy` | `"summary" \| "sliding-window"` | `"summary"` | How an old daily log is collapsed |
| `searchMode` | `"keyword" \| "hybrid"` | `"keyword"` | Search backend. `hybrid` reserved for when a vector node is wired |
| `exposeMemorySearch` | `boolean` | `true` | Expose `memory_search` to the agent |
| `exposeMemoryGet` | `boolean` | `true` | Expose `memory_get` to the agent |
| `exposeMemorySave` | `boolean` | `true` | Expose `memory_save` to the agent |

## Runtime Behavior

At runtime the configuration is resolved into a `ResolvedMemoryConfig` and
used to instantiate a `MemoryEngine` (`server/runtime/memory-engine.ts`).
The engine receives a reference to the agent's `StorageEngine`, which
already exposes the per-file primitives:

- `MEMORY.md` is read/written via `storage.readLongTermMemory()` /
  `storage.writeLongTermMemory()`.
- `memory/YYYY-MM-DD.md` files are appended via
  `storage.appendDailyMemory(content, date)`.

**Bootstrap injection.** `buildBootstrapContext()` assembles a markdown
block to surface at session start: long-term first (capped at
`longTermMaxBytes`), then the most recent `autoLoadShortTermDays` daily
logs newest-first.

**Compaction strategies** (only applied to daily logs older than
`compactionAfterDays`; long-term is never auto-compacted):

- `sliding-window` — replaces the file's content with a compaction marker;
  the old bulk is dropped.
- `summary` — keeps the first line of every bullet so the shape of the
  day stays searchable while the bulk is collapsed.

Compaction now **overwrites** the daily file (via an atomic
`storage.writeDailyMemory(...)`) with the marker (sliding-window) or the
one-line summary header (summary), so the file is actually pruned and
collapsed. Previously compaction *appended* the marker/summary, which left
the full original content in place and grew the file instead of freeing
space, so search still pulled the full bulk.

Long-term memory (`MEMORY.md`) appends are serialized, so two concurrent
`memory_save(long_term)` calls in the same turn can no longer lose an entry.

**Memory tools** (created by `MemoryEngine.createMemoryTools()`):

- `memory_save({ scope: "long_term" | "short_term", content })` — appends
  a timestamped bullet to either `MEMORY.md` or today's daily log.
- `memory_get({ scope, date? })` — returns the full contents of a memory
  file. `date` is only consulted when `scope = short_term`; it defaults
  to today.
- `memory_search({ query })` — case-insensitive substring search across
  `MEMORY.md` and every daily log. Returns at most 20 hits, each with
  source file, line number, and a single-line excerpt so the agent can
  follow up with `memory_get`.

Each tool checks for the presence of a Storage engine. If none is wired
the tool returns the string `Memory is offline — no Storage node
connected.` instead of silently dropping data.

## Connections

- **Sends to**: Agent Node (the agent that owns this memory).
- **Requires**: a Storage Node connected to the same agent. Without it
  the memory engine has no place to read or write files and every tool
  reports as offline.
- At most one Memory Node should be connected to an agent. If multiple
  are connected, only the first one found is used.

## Example

```json
{
  "type": "memory",
  "label": "Project Memory",
  "autoLoadLongTerm": true,
  "longTermMaxBytes": 8000,
  "autoLoadShortTermDays": 2,
  "compactionEnabled": true,
  "compactionAfterDays": 14,
  "compactionStrategy": "summary",
  "searchMode": "keyword",
  "exposeMemorySearch": true,
  "exposeMemoryGet": true,
  "exposeMemorySave": true
}
```
