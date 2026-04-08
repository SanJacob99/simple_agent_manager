# Session Numbered Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each new non-default session a persistent numbered label so users can tell sessions apart quickly.

**Architecture:** Keep the change inside the frontend session store, where session creation already decides the outgoing `displayName`. Add a small helper that scans same-agent sessions for existing `Session N` labels and picks the next number, then cover it with focused store tests.

**Tech Stack:** TypeScript, Zustand, Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-session-numbered-labels-design.md`

---

## File Structure

### Modified files
| File | Responsibility |
|------|----------------|
| `src/store/session-store.ts` | Generate numbered display names for new non-default sessions |
| `src/store/session-store.test.ts` | Verify numbering behavior for new sessions |

### Task 1: Add failing tests for numbered session labels

**Files:**
- Modify: `src/store/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests that verify:
- the first new non-default session is named `Session 1`
- the next one uses the next available number for the same agent

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/session-store.test.ts`
Expected: FAIL because `createSession()` still sends `provider/model`.

### Task 2: Implement numbered label generation

**Files:**
- Modify: `src/store/session-store.ts`

- [ ] **Step 1: Add a helper for next session number**

Scan same-agent sessions for `displayName` values matching `Session N` and return the next available integer.

- [ ] **Step 2: Use the helper in `createSession()`**

Keep `Main session` for default sessions and use `Session N` for every new non-default session.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/store/session-store.test.ts`
Expected: PASS

### Task 3: Final verification

- [ ] **Step 1: Run the targeted test file again**

Run: `npx vitest run src/store/session-store.test.ts`
Expected: PASS
