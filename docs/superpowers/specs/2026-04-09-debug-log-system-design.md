# Debug Log System Design

**Date:** 2026-04-09
**Status:** Approved

## Problem

Three server-side log categories flood the Node terminal during development, making it hard to read useful output:

- `[TIMING:SERVER]` — lap timers in `run-coordinator.ts`
- `[pi-ai Request Payload]` — full pretty-printed API request JSON in `agent-runtime.ts`
- `[ws]` — WebSocket command-received events in `ws-handler.ts`

## Solution

A thin logger module (`server/logger.ts`) routes these logs to a file instead of the terminal. Errors and connection lifecycle events remain in the terminal.

## Logger Module — `server/logger.ts`

Opens `logs/debug.log` with `fs.createWriteStream(path, { flags: 'w' })` on import, truncating any previous content (fresh log per server startup). Creates `logs/` if it doesn't exist.

### Exports

```ts
log(category: string, message: string): void
```
Writes `[ISO timestamp] [CATEGORY] message\n` to file only.

```ts
logError(category: string, message: string): void
```
Writes to file AND calls `console.error(...)`. Used for errors that must surface in terminal.

```ts
logConsoleAndFile(category: string, message: string): void
```
Writes to file AND calls `console.log(...)`. Used for connection lifecycle events that are useful to see in terminal.

`logs/debug.log` is added to `.gitignore`.

## Call Site Changes

### `server/connections/ws-handler.ts`

| Current | New |
|---|---|
| `console.log('[ws] Client connected')` | `logConsoleAndFile` |
| `console.log('[ws] Client disconnected')` | `logConsoleAndFile` |
| `console.log('[ws] Received command: ...')` | `log` (file only) |
| `console.error('[ws] Socket error:', ...)` | `logError` (terminal + file) |

### `server/agents/run-coordinator.ts`

Both `_lap` closures (in `dispatch()` and `executeRun()`) change their inner `console.log` to `log`. Terminal output: none.

### `server/runtime/agent-runtime.ts`

The `[pi-ai Request Payload]` log is replaced with a summary builder (inline helper). It extracts:

- `model` — model ID string
- `messages.length` — message count
- `tools.length` — tool count (0 if none)
- Last user message content — first 200 chars, truncated with `...` if longer

Example log line:
```
[2026-04-09T14:32:01.123Z] [pi-ai Request Payload] model=claude-sonnet-4-6 | messages=6 | tools=3 | last_user=What is the capital of France?
```

Written via `log` (file only).

### `server/index.ts`

Startup messages (`Server listening on...`, `WebSocket available at...`, `[Settings] Loaded API keys...`, shutdown messages) are **unchanged** — they remain as `console.log` since they are useful startup signals.

## Files Changed

| File | Change |
|---|---|
| `server/logger.ts` | New file |
| `server/connections/ws-handler.ts` | Import logger, replace console calls |
| `server/agents/run-coordinator.ts` | Import logger, replace `_lap` console.log |
| `server/runtime/agent-runtime.ts` | Import logger, replace payload log with summary |
| `logs/` | Created at runtime (not committed) |
| `.gitignore` | Add `logs/` |

## Non-Goals

- No log rotation (file is overwritten on each startup)
- No log levels beyond file-vs-terminal routing
- No changes to `[TIMING:CLIENT]` in `src/chat/useChatStream.ts` (browser console, unaffected)
- No changes to `server/index.ts` startup logs
