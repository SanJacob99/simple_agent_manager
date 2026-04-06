
# 🦑 Simple Agent Manager - Node Based Agent Builder

![Cyborg Squid Logo](./docs/logo.png)

A node-based graphical interface for building and managing custom AI agents. Drag-and-drop nodes onto a canvas to visually configure agents with memory, tools, context engines, databases, and more -- then chat with them directly from the dashboard.

Built with React 19, TypeScript, and [@xyflow/react](https://reactflow.dev/) for the graph editor. Features a full-stack architecture with a Node.js/Express/WebSocket backend powered by [pi-agent-core](https://github.com/nicepkg/pi-mono) for the agent runtime.

## Features

- **Visual Agent Builder** -- Drag agent and peripheral nodes onto a canvas, connect them with edges to define agent capabilities
- **OpenClaw-Inspired Architecture** -- Memory, tools, and context engine nodes modeled after [OpenClaw](https://docs.openclaw.ai/) concepts
- **Client-Server Architecture** -- Agent configs are serializable JSON sent to a Node.js backend. Agents run securely on the server with full access to files and external APIs.
- **Session-Based Chat** -- Conversations are strictly isolated into distinct, immutable sessions to prevent context leakage. Automatically manages history limits and prunes old sessions.
- **Multi-Provider LLM Support** -- OpenRouter, OpenAI, Anthropic, Google AI Studio, Google Vertex AI, Azure OpenAI, Mistral, Groq, xAI, Cerebras, MiniMax, Vercel AI Gateway, Ollama
- **Memory Engine** -- Multiple backends (builtin/external/cloud), compaction strategies (summary/sliding-window/hybrid), memory tools (search/get/save) exposed to agents
- **Tool System** -- Profiles (full/coding/messaging/minimal), groups (runtime/fs/web/memory/coding/communication), skills (markdown instructions), plugins
- **Context Engine** -- Token budget management, compaction lifecycle (assemble/compact/afterTurn), RAG integration, system prompt additions
- **Settings Modal** -- API key management per provider, stored in localStorage
- **Export/Import** -- Export graphs as JSON bundles, import from file, load pre-built test fixtures
- **Dark Theme** -- Tailwind CSS dark UI throughout

## Node Types

| Node | Description |
|------|-------------|
| **Agent** | Central hub node -- LLM provider, model, system prompt, thinking level |
| **Memory** | How the agent remembers -- backends, compaction, memory tools |
| **Tools** | Agent capabilities -- tool profiles, groups, skills, plugins |
| **Skills** | Standalone skill definitions injected into the system prompt |
| **Context Engine** | Context management -- token budget, compaction, RAG |
| **Agent Comm** | Inter-agent communication (direct/broadcast) |
| **Connectors** | External service connectors (REST API, etc.) |
| **Database** | Data storage (PostgreSQL, MySQL, SQLite, MongoDB, IndexedDB, REST API) |
| **Vector Database** | Vector storage (Pinecone, ChromaDB, Qdrant, Weaviate) |

## Concepts Documentation

Detailed documentation for each node type lives in [`docs/concepts/`](docs/concepts/). Each concept doc covers the node's purpose, configuration properties, runtime behavior, connections, and examples. These docs are maintained by AI tools via rules in `CLAUDE.md` and `.agents/rules/docs-maintenance.md`.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
```

Output is in `dist/`.

### Real OpenRouter Tests

To run the opt-in live OpenRouter tests, create a local `.env` file with:

```bash
OPENROUTER_API_KEY=your_key_here
# Optional override; defaults to qwen/qwen3.6-plus:free
OPENROUTER_MODEL=qwen/qwen3.6-plus:free
```

Then run:

```bash
npm run test:openrouter
npm run test:e2e:openrouter
```

`npm run test:openrouter` exercises the backend integration path. `npm run test:e2e:openrouter` starts the real client and server, sends a message through the browser UI, and captures a trace of critical fetch and WebSocket milestones. Both are intentionally opt-in because they make live API calls and may incur cost or fail for network/provider reasons. The browser E2E retries automatically because live provider responses, especially free models, can occasionally return an empty turn.

### Usage

1. **Configure API keys** -- Click the gear icon (top-right) to open Settings and enter your provider API keys
2. **Create an agent** -- Drag an "Agent" node onto the canvas from the left sidebar
3. **Add peripherals** -- Drag Memory, Tools, Context Engine, or Database nodes and connect them to the agent
4. **Customize** -- Click any node to open the properties panel on the right and configure it
5. **Chat** -- Click the "Chat" button on an agent node to open the chat drawer, create a new session or select an existing one, and start a conversation
6. **Export/Import** -- Use the sidebar action buttons to export your graph, import one, or load the built-in test fixture


### Provider API Key Setup

In **Settings → Providers & API Keys**, each provider row now includes a direct **“Get … key”** link to the provider portal.

Current providers with key setup links: OpenAI, Anthropic, Google AI Studio, Google Vertex AI, OpenRouter, Azure OpenAI, Groq, xAI, Mistral, Cerebras, MiniMax, and Vercel AI Gateway. Ollama runs locally and does not require a cloud key.

## Architecture

```
Client (React Flow UI)
  -> Graph Nodes/Edges
  -> resolveAgentConfig()  -->  AgentConfig (serializable JSON)
  -> AgentClient (WebSocket connection & event subscription)

Server (Node.js + Express + WebSockets)
  -> agent-manager (Manages active runtimes)
    -> AgentRuntime             (wraps pi-agent-core Agent)
      -> MemoryEngine           (backends, compaction, memory tools)
      -> ContextEngine          (assemble/compact lifecycle, token budget)
      -> ToolFactory            (profiles, groups -> AgentTool instances)
```

**Config Layer** -- Node data types and graph traversal produce a serializable `AgentConfig` (pure JSON).

**Server Layer** -- The backend runs `AgentRuntime` using the provided configuration, executing real `pi-agent-core` agents with their provided tools, memory, and context.

**UI Layer** -- React components subscribe to WebSocket events for streaming updates, tool call displays, and status indicators.

## Tech Stack

- **React 19** + TypeScript + Vite 6
- **Express 5** + **ws 8** -- Backend and WebSockets
- **@xyflow/react 12** -- Node-based graph editor
- **@mariozechner/pi-ai** -- Unified LLM API (stream, getModel, KnownProvider)
- **@mariozechner/pi-agent-core** -- Agent class with tools, transformContext, event subscription
- **Zustand 5** -- State management
- **Tailwind CSS 4** -- Styling
- **@sinclair/typebox** -- Tool parameter schemas
- **lucide-react** -- Icons

## Project Structure

```
server/             Node.js backend, Express, WebSocket handler
  agents/           Agent execution and runtime management
  auth/             API key management
  connections/      WebSocket connection management
  runtime/          Agent runtime (memory, context, tools)
shared/             Shared types and agent configs (Client & Server)
src/                React Frontend
  canvas/          Flow canvas and drag-and-drop
  chat/            Chat drawer, Session Management, and WebSocket Client
  edges/           Custom edge components
  fixtures/        Test graph fixtures
  nodes/           Node components (Agent, Memory, Tools, etc.)
  panels/          Sidebar, properties panel, property editors
  store/           Zustand stores (graph, session, storage)
  types/           TypeScript types (nodes, graph)
  utils/           Utilities (theme, defaults, export/import)
```

## License

MIT
