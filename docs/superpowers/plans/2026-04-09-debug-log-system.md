# Debug Log System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `[TIMING:SERVER]`, `[pi-ai Request Payload]`, and `[ws]` command logs to a file (`logs/debug.log`) instead of the terminal, while keeping errors and connection lifecycle in the terminal.

**Architecture:** A thin `server/logger.ts` module opens `logs/debug.log` with `flags: 'w'` on import (fresh per startup), exports `log`, `logError`, and `logConsoleAndFile`. Each of the three call-site files imports logger and replaces its `console.log` calls. The `[pi-ai Request Payload]` site is replaced with an inline summary builder.

**Tech Stack:** Node.js `fs.createWriteStream`, Vitest for tests. No new dependencies.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `server/logger.ts` | Open write stream, export log/logError/logConsoleAndFile |
| Create | `server/logger.test.ts` | Verify console routing (logError → console.error, logConsoleAndFile → console.log, log → neither) |
| Modify | `server/connections/ws-handler.ts` | Replace console calls with logger |
| Modify | `server/connections/ws-handler.test.ts` | Add vi.mock for logger to prevent file I/O |
| Modify | `server/agents/run-coordinator.ts` | Replace _lap console.log with logger |
| Modify | `server/agents/run-coordinator.test.ts` | Add vi.mock for logger to prevent file I/O |
| Modify | `server/runtime/agent-runtime.ts` | Replace onPayload console.log with summary builder + logger |
| Modify | `server/runtime/agent-runtime.test.ts` | Add vi.mock for logger to prevent file I/O |
| Modify | `.gitignore` | Add `logs/` |

---

## Task 1: Create `server/logger.ts` and its test

**Files:**
- Create: `server/logger.ts`
- Create: `server/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/logger.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs before importing logger so no real file is created
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
    })),
  };
});

// Dynamic import so mock is applied first
const { log, logError, logConsoleAndFile } = await import('./logger');

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log() does not call console.error or console.log', () => {
    log('TEST', 'hello');
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logError() calls console.error with category and message', () => {
    logError('ws', 'Socket error: connection reset');
    expect(console.error).toHaveBeenCalledWith('[ws]', 'Socket error: connection reset');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logConsoleAndFile() calls console.log with category and message', () => {
    logConsoleAndFile('ws', 'Client connected');
    expect(console.log).toHaveBeenCalledWith('[ws]', 'Client connected');
    expect(console.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/logger.test.ts
```

Expected: FAIL — `Cannot find module './logger'`

- [ ] **Step 3: Implement `server/logger.ts`**

```typescript
import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

const stream = fs.createWriteStream(path.join(logsDir, 'debug.log'), { flags: 'w' });

function formatLine(category: string, message: string): string {
  return `[${new Date().toISOString()}] [${category}] ${message}\n`;
}

export function log(category: string, message: string): void {
  stream.write(formatLine(category, message));
}

export function logError(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.error(`[${category}]`, message);
}

export function logConsoleAndFile(category: string, message: string): void {
  stream.write(formatLine(category, message));
  console.log(`[${category}]`, message);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/logger.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
cd c:/Projects/simple_agent_manager && git add server/logger.ts server/logger.test.ts && git commit -m "feat: add server logger module routing debug logs to file"
```

---

## Task 2: Update `server/connections/ws-handler.ts`

**Files:**
- Modify: `server/connections/ws-handler.ts`
- Modify: `server/connections/ws-handler.test.ts`

- [ ] **Step 1: Add `vi.mock` for logger in the test file**

Open `server/connections/ws-handler.test.ts`. Add this after the existing imports (before the `describe` block):

```typescript
vi.mock('../logger');
```

- [ ] **Step 2: Run existing ws-handler tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/connections/ws-handler.test.ts
```

Expected: PASS (same as before)

- [ ] **Step 3: Update `ws-handler.ts` to use logger**

Replace the top of `server/connections/ws-handler.ts`. Add the import after the existing imports:

```typescript
import { log, logError, logConsoleAndFile } from '../logger';
```

Then replace each console call:

| Find | Replace with |
|---|---|
| `console.log('[ws] Client connected');` | `logConsoleAndFile('ws', 'Client connected');` |
| `console.log(\`[ws] Received command: ${command.type}\`, ...)` | `log('ws', \`Received command: ${command.type}\${...}\`);` |
| `console.log('[ws] Client disconnected');` | `logConsoleAndFile('ws', 'Client disconnected');` |
| `console.error('[ws] Socket error:', err.message);` | `logError('ws', \`Socket error: ${err.message}\`);` |

The full updated lines:

```typescript
// line 15
logConsoleAndFile('ws', 'Client connected');

// line 22 (inside message handler)
log('ws', `Received command: ${command.type}${('agentId' in command) ? ` (Agent: ${(command as any).agentId})` : ''}`);

// line 132 (close handler)
logConsoleAndFile('ws', 'Client disconnected');

// line 137 (error handler)
logError('ws', `Socket error: ${err.message}`);
```

- [ ] **Step 4: Run ws-handler tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/connections/ws-handler.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd c:/Projects/simple_agent_manager && git add server/connections/ws-handler.ts server/connections/ws-handler.test.ts && git commit -m "feat: route ws-handler logs to debug file"
```

---

## Task 3: Update `server/agents/run-coordinator.ts`

**Files:**
- Modify: `server/agents/run-coordinator.ts`
- Modify: `server/agents/run-coordinator.test.ts`

- [ ] **Step 1: Add `vi.mock` for logger in the test file**

Open `server/agents/run-coordinator.test.ts`. Add after the existing imports:

```typescript
vi.mock('../logger');
```

- [ ] **Step 2: Run existing run-coordinator tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/agents/run-coordinator.test.ts
```

Expected: PASS

- [ ] **Step 3: Add logger import to `run-coordinator.ts`**

Open `server/agents/run-coordinator.ts`. Add to the imports at the top:

```typescript
import { log } from '../logger';
```

- [ ] **Step 4: Update both `_lap` closures to use `log`**

There are two `_lap` definitions in the file.

**First `_lap`** (around line 135, inside `dispatch()`):

```typescript
// Before
const _lap = (label: string) => console.log(`[TIMING:SERVER] +${Date.now() - _t0}ms ${label}`);

// After
const _lap = (label: string) => log('TIMING:SERVER', `+${Date.now() - _t0}ms ${label}`);
```

**Second `_lap`** (around line 407, inside `executeRun()`):

```typescript
// Before
const _lap = (label: string) => console.log(`[TIMING:SERVER] +${Date.now() - _t0}ms ${label} [runId=${record.runId.slice(0, 8)}]`);

// After
const _lap = (label: string) => log('TIMING:SERVER', `+${Date.now() - _t0}ms ${label} [runId=${record.runId.slice(0, 8)}]`);
```

- [ ] **Step 5: Run run-coordinator tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/agents/run-coordinator.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd c:/Projects/simple_agent_manager && git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts && git commit -m "feat: route TIMING:SERVER logs to debug file"
```

---

## Task 4: Update `server/runtime/agent-runtime.ts` with payload summary

**Files:**
- Modify: `server/runtime/agent-runtime.ts`
- Modify: `server/runtime/agent-runtime.test.ts`

- [ ] **Step 1: Add `vi.mock` for logger in the test file**

Open `server/runtime/agent-runtime.test.ts`. Add after the existing imports:

```typescript
vi.mock('../logger');
```

- [ ] **Step 2: Run existing agent-runtime tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/runtime/agent-runtime.test.ts
```

Expected: PASS

- [ ] **Step 3: Add logger import and summary helper to `agent-runtime.ts`**

Add to the imports at the top of `server/runtime/agent-runtime.ts`:

```typescript
import { log } from '../logger';
```

Add this private helper function just before the `AgentRuntime` class definition (after the imports, before `export type RuntimeEvent`... actually place it right before the class):

```typescript
function summarizePayload(payload: any): string {
  const model: string = payload.model ?? 'unknown';
  const messages: any[] = payload.messages ?? [];
  const tools: any[] = payload.tools ?? [];
  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
  let lastUserText = '';
  if (lastUser) {
    const content = lastUser.content;
    if (typeof content === 'string') {
      lastUserText = content.length > 200 ? content.slice(0, 200) + '...' : content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find((b: any) => b.type === 'text');
      if (textBlock?.text) {
        const t: string = textBlock.text;
        lastUserText = t.length > 200 ? t.slice(0, 200) + '...' : t;
      }
    }
  }
  return `model=${model} | messages=${messages.length} | tools=${tools.length} | last_user=${lastUserText}`;
}
```

- [ ] **Step 4: Replace the `onPayload` console.log**

Find in `server/runtime/agent-runtime.ts` (around line 97):

```typescript
onPayload: (payload) => {
  console.log('[pi-ai Request Payload]', JSON.stringify(payload, null, 2));
},
```

Replace with:

```typescript
onPayload: (payload) => {
  log('pi-ai Request Payload', summarizePayload(payload));
},
```

- [ ] **Step 5: Run agent-runtime tests to confirm they still pass**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run server/runtime/agent-runtime.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd c:/Projects/simple_agent_manager && git add server/runtime/agent-runtime.ts server/runtime/agent-runtime.test.ts && git commit -m "feat: route pi-ai payload log to debug file with summary"
```

---

## Task 5: Update `.gitignore` and run full test suite

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `logs/` to `.gitignore`**

Open `.gitignore` and add the following line (at the end or in the build artifacts section):

```
logs/
```

- [ ] **Step 2: Run full test suite**

```bash
cd c:/Projects/simple_agent_manager && npx vitest run
```

Expected: All tests pass (same count as before plus the 3 new logger tests).

- [ ] **Step 3: Commit**

```bash
cd c:/Projects/simple_agent_manager && git add .gitignore && git commit -m "chore: ignore logs/ directory"
```

---

## Verification

After all tasks, start the dev server and confirm:

```bash
npm run dev:server
```

- Terminal shows: `[ws] Client connected` when UI opens, `[ws] Client disconnected` on close, `[ws] Socket error: ...` on error, server startup messages
- Terminal does NOT show: `[TIMING:SERVER]`, `[pi-ai Request Payload]`, `[ws] Received command:`
- `logs/debug.log` exists and contains all routed log lines with ISO timestamps
- On next `npm run dev:server`, `logs/debug.log` is fresh (previous content gone)
