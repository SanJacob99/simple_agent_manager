# Session Numbered Labels Design

**Date:** 2026-04-08
**Scope:** Improve non-default chat session names so users can distinguish sessions at a glance.

## Overview

Today, new non-default sessions are labeled with the same `provider/model` string. When a user creates multiple sessions for the same agent and model, the dropdown shows near-identical names and relies mostly on timestamps to differentiate them.

This change keeps `Main session` for the default session and assigns every newly created non-default session a persistent numbered label: `Session 1`, `Session 2`, `Session 3`, and so on.

## Goals

- Make session labels easy to scan in the chat drawer.
- Keep labels stable after creation.
- Scope numbering to each agent so labels remain local and understandable.

## Non-Goals

- Renaming existing persisted sessions.
- Renumbering old sessions after deletion.
- Changing session sorting or timestamp display.

## Design

The frontend session store already chooses the `displayName` it sends when it creates a session. We will update that path so non-default sessions derive their label from the agent's existing sessions instead of using `provider/model`.

### Naming rules

- Default session: `Main session`
- First non-default session for an agent: `Session 1`
- Each later non-default session for that agent: highest existing `Session N` + 1

### Stability rules

- Once created, the label stays attached to that session.
- Deleted session numbers are not reused.
- Existing sessions with non-numbered names are ignored when calculating the next number.

## Affected files

- `src/store/session-store.ts`
- `src/store/session-store.test.ts`

## Testing

- Verify the first non-default session uses `Session 1`.
- Verify numbering increments from the highest existing numbered session for the same agent.
- Verify `Main session` and non-numbered labels do not break numbering.
