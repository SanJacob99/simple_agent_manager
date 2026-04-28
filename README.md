# 🦑 Simple Agent Manager - Node Based Agent Builder

![Simple Agent Manager logo](./docs/logo.png)

Simple Agent Manager is a node-based visual AI agent builder. You assemble an agent on a canvas, resolve that graph into a serializable `AgentConfig`, and run it through a local Express + WebSocket backend.

The project is built with React 19, TypeScript, `@xyflow/react`, and `@mariozechner/pi-agent-core`.

## What is working today

- Drag-and-drop graph editing for agent and peripheral nodes
- In-browser graph resolution via `src/utils/graph-to-agent.ts`
- Local backend runtime in `server/` with streamed chat over WebSockets
- Storage-backed sessions, transcript persistence, retention, and maintenance
- Context budgeting and compaction through the context engine
- Memory tools exposed from the memory engine
- Settings workspace for provider keys, OpenRouter model discovery, defaults, and data maintenance
- Graph import/export plus a bundled test fixture

## Current scope and caveats

- Interactive chat is blocked unless an agent has both a connected `Context Engine` node and a connected `Storage` node.
- OpenRouter model discovery is live; the other providers currently use curated static model lists in the UI.
- Several node types and tool names are still extension surfaces rather than fully wired product features. In particular, `connectors`, `agentComm`, `vectorDatabase`, and `cron` need runtime inspection before you treat them as end-to-end features.
- The current built-in tool surface includes real implementations for `calculator`, `web_fetch`, memory tools, and session tools. Many other named tools are placeholders/stubs.

## Node palette

The default sidebar currently exposes these draggable nodes:

| Node | Purpose |
| --- | --- |
| `agent` | Core agent identity, model, prompt, and reasoning settings |
| `memory` | Memory backend, compaction, and memory tool toggles |
| `tools` | Tool profiles, custom tool names, inline skills, and plugin bindings |
| `skills` | Lightweight named skills that are folded into the resolved system prompt |
| `contextEngine` | Token budget, compaction strategy, and prompt bootstrap limits |
| `agentComm` | Configuration surface for agent-to-agent communication |
| `connectors` | Configuration surface for external connector metadata |
| `storage` | Session persistence, retention, maintenance, and memory file settings |
| `vectorDatabase` | Configuration surface for vector-store metadata |

The codebase also contains a `cron` node type and editor, but it is not part of the default palette and should be treated as in-progress unless you verify the full execution path.

## Architecture

```text
src/
  React UI: canvas, chat drawer, property editors, settings, Zustand stores

shared/
  Serializable agent config, shared protocol/types, tool resolution,
  token estimation, and system prompt assembly

server/
  Express + WebSocket backend, agent manager, run coordinator, runtime engines,
  storage/session routing, hooks, and transcript persistence
```

High-level flow:

1. The canvas graph lives in `src/store/graph-store.ts`.
2. `src/utils/graph-to-agent.ts` resolves the graph into `shared/agent-config.ts`.
3. The frontend starts or updates an agent through the local backend.
4. `server/agents/run-coordinator.ts` and `server/runtime/*` execute the run, stream events, and persist transcripts.

## Settings workspace

The settings view currently includes four sections:

- `Providers & API Keys`: browser-local provider credentials, plus direct links to provider key pages
- `Model Catalog`: OpenRouter sync and model inspection
- `Defaults`: default provider/model/thinking level, prompt mode, safety guardrails, and storage path
- `Data & Maintenance`: graph import/export, fixture loading, resets, and storage maintenance runs

## Getting started

### Prerequisites

- Node.js 18+
- npm

### Install and run

```bash
npm install
npm run dev
```

This starts:

- the Vite frontend at `http://localhost:5173`
- the local backend at `http://localhost:3210`

### Basic usage

1. Open Settings and add a provider API key.
2. Drag an `Agent` node onto the canvas.
3. Add and connect at least a `Context Engine` node and a `Storage` node.
4. Optionally connect `Memory`, `Tools`, `Skills`, and other peripheral nodes.
5. Configure the selected node in the right-hand properties panel.
6. Open the chat drawer from the agent node and start a session.

## SAM CLI

`sam` is the operator CLI for repo-scoped maintenance tasks. After `npm install` it is reachable as `npx sam …` from anywhere inside the project, or as `npm run sam -- …` if you prefer the npm-script form. Run `sam help` for the live command list.

Today:

| Command                  | What it does                       |
| ------------------------ | ---------------------------------- |
| `sam help`               | Print the command list and exit.   |
| `sam version`            | Print the SAM version from `package.json`. |
| `sam diagnose`           | Probe the local backend (`/api/health`, `/api/tools`) and report the resolved user-tools directory and any `SAM_*` env overrides. Read-only. |
| `sam install tool <url>` | Fetch a `*.module.ts` user tool from a GitHub repo (`https://github.com/owner/repo[/tree/<ref>]`), validate it, and install into the user-tools directory. Synthesizes a `sam.json` manifest if the repo doesn't ship one. |
| `sam uninstall tool <name>` | Remove an installed user tool. Asks for the tool name as confirmation before deleting. |
| `sam list tools`         | Print a table of installed user tools with name, version, source, and state. Disabled rows are dimmed. |
| `sam enable tool <name>` / `sam disable tool <name>` | Flip the `disabled` flag in the tool's `sam.json` without touching the source. The server skips loading any `*.module.ts` in a directory whose `sam.json` has `disabled: true` (logs `[tool-registry] skipping <name>: disabled via sam.json` at startup). Restart the backend for the change to take effect. |
| `sam restart`            | Stop the running backend, start a fresh one, and wait for `/api/health`. Blocks for ~5–15s with progress output, then returns. The new server runs detached; its stdout/stderr is captured to `.sam/server.log`. |

The user-tools directory follows the same precedence the server uses: `SAM_DISABLE_USER_TOOLS=1` short-circuits everything; otherwise `SAM_USER_TOOLS_DIR=<path>` overrides; otherwise `server/tools/user/`.

After `sam install` or `sam uninstall`, run `sam restart` (or restart `npm run dev:server` manually) for the new tool to load.

`sam restart` deliberately spawns the new server **without** Node's `--watch-path` mode — that mode opens an extra console window on Windows that can't be hidden. The trade-off is that file edits aren't picked up automatically: re-run `sam restart` to load new code. If you want auto-reload during normal development, keep using `npm run dev:server` directly; `sam restart` is the manual restart trigger. Server logs go to `.sam/server.log` (truncated each restart). **Caveat:** if the project was launched via `npm run dev` (concurrently + vite), restart still stops the server, but vite goes down with it because concurrently exits when one child dies — re-run `npm run dev` to bring vite back. Production supervisors (systemd, PM2) are not detected.

The CLI source lives under [bin/](bin/) — plain ESM Node, no build step. The dispatcher is [bin/sam.js](bin/sam.js); each command lives in its own file under [bin/commands/](bin/commands/) and shared helpers under [bin/lib/](bin/lib/). The `sam.json` schema (source of truth) is [shared/user-tool-manifest.ts](shared/user-tool-manifest.ts). Server-side restart coordination lives in [server/runtime-state.ts](server/runtime-state.ts); the `disabled`-flag filter lives in [server/tools/tool-registry.ts](server/tools/tool-registry.ts).

## Tests and verification

```bash
npm test
npm run test:run
npm run build
```

Opt-in live OpenRouter tests:

```bash
# Copy .env.example to .env and add a real key
OPENROUTER_API_KEY=your_key_here
# Optional: defaults to openai/gpt-4o-mini in the test
OPENROUTER_MODEL=openai/gpt-4o-mini
```

```bash
npm run test:openrouter
npm run test:e2e:openrouter
```

These live tests make real network calls and can fail for provider, network, or quota reasons.

## Documentation

- Node concept docs live in `docs/concepts/`
- Agent-facing repository guidance lives in `AGENTS.md`
- Shared config and prompt assembly are centered in `shared/agent-config.ts` and `shared/system-prompt-builder.ts`

If you change node schemas, defaults, or runtime behavior, update the matching concept docs as part of the same change.

## Project structure

```text
docs/                 Concept docs and project assets
server/               Express server, WebSocket handling, runtime, storage, hooks
shared/               Shared config/types/helpers used by both client and server
src/                  React app, canvas UI, settings UI, chat UI, browser helpers
storage/              Persisted local agent/session data
e2e/                  Playwright coverage
```

## License

MIT
