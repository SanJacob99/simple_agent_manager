# App Settings Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal with a dedicated app-level settings workspace that supports API keys, OpenRouter catalog status/refresh, agent defaults, and data-maintenance actions.

**Architecture:** Keep the app as a single-screen React shell and add a top-level `canvas/settings` view mode in `App.tsx`. Persist app-level settings in the settings store, apply agent defaults only inside `graph-store.ts` when creating or updating agents, and move operational actions into focused settings-section components so the canvas sidebar stays graph-focused.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Tailwind CSS 4, React Flow, Vitest, Testing Library

---

## File Structure

### Existing files to modify

- `src/App.tsx`
  Responsibility: own the top-level app view mode, switch between canvas and settings workspaces, keep startup OpenRouter sync, and suppress canvas-only panels in settings mode.
- `src/panels/Sidebar.tsx`
  Responsibility: render the node palette in canvas mode and the settings section navigation in settings mode.
- `src/settings/settings-store.ts`
  Responsibility: persist both `apiKeys` and `agentDefaults`, expose update helpers, and expose a reset action for app settings.
- `src/store/graph-store.ts`
  Responsibility: overlay app defaults when creating agent nodes, expose `applyAgentDefaultsToExistingAgents()`, and expose `clearGraph()`.
- `src/store/session-store.ts`
  Responsibility: expose a `resetAllSessions()` action used by Data & Maintenance.
- `src/store/model-catalog-store.ts`
  Responsibility: keep OpenRouter loading/error state and support forced manual refresh from the settings UI.
- `src/store/model-catalog-store.test.ts`
  Responsibility: verify forced refresh behavior and existing sync guarantees after the store API changes.
- `src/settings/SettingsModal.tsx`
  Responsibility: delete once the settings workspace replaces it.

### New files to create

- `src/settings/types.ts`
  Responsibility: shared `AgentDefaults` type, default values, section IDs, and section metadata used by the sidebar and settings workspace.
- `src/settings/SettingsWorkspace.tsx`
  Responsibility: render the settings page shell, section header, and active section component.
- `src/settings/sections/ProvidersApiKeysSection.tsx`
  Responsibility: render provider key inputs and local-storage helper copy.
- `src/settings/sections/ModelCatalogSection.tsx`
  Responsibility: render OpenRouter sync status and the manual refresh action.
- `src/settings/sections/DefaultsSection.tsx`
  Responsibility: edit agent defaults and confirm the “apply to existing agents” workflow.
- `src/settings/sections/DataMaintenanceSection.tsx`
  Responsibility: own import/export/test-fixture actions plus scoped reset/clear actions and inline import error messaging.
- `src/settings/settings-store.test.ts`
  Responsibility: verify settings persistence and reset behavior.
- `src/store/graph-store.test.ts`
  Responsibility: verify agent-default application, manual default application to existing agents, and graph clearing.
- `src/settings/SettingsWorkspace.test.tsx`
  Responsibility: verify section switching and section-specific UI rendering in the dedicated workspace.
- `src/App.test.tsx`
  Responsibility: verify app-mode switching hides canvas-only chrome without clearing selected-node state.
- `src/settings/sections/DefaultsSection.test.tsx`
  Responsibility: verify default edits persist and the apply-defaults action is confirmation-gated.
- `src/settings/sections/DataMaintenanceSection.test.tsx`
  Responsibility: verify import errors are shown inline and destructive actions only run after confirmation.

## Task 1: Add Settings Types And Persisted Agent Defaults

**Files:**
- Create: `src/settings/types.ts`
- Modify: `src/settings/settings-store.ts`
- Test: `src/settings/settings-store.test.ts`

- [ ] **Step 1: Write the failing settings-store tests**

Create `src/settings/settings-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';
import { DEFAULT_AGENT_DEFAULTS } from './types';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
    });
  });

  it('persists agent defaults alongside api keys', () => {
    useSettingsStore.getState().setApiKey('openrouter', 'key-1');
    useSettingsStore.getState().setAgentDefaults({
      provider: 'openai',
      modelId: 'gpt-4o',
      thinkingLevel: 'high',
      systemPrompt: 'Be concise.',
    });

    const stored = JSON.parse(
      localStorage.getItem('agent-manager-settings') ?? '{}',
    );

    expect(stored.apiKeys.openrouter).toBe('key-1');
    expect(stored.agentDefaults.provider).toBe('openai');
    expect(stored.agentDefaults.systemPrompt).toBe('Be concise.');
  });

  it('resets settings back to api-key empty state and default agent defaults', () => {
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPrompt: 'Be concise.',
      },
    });

    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().apiKeys).toEqual({});
    expect(useSettingsStore.getState().agentDefaults).toEqual(
      DEFAULT_AGENT_DEFAULTS,
    );
  });
});
```

- [ ] **Step 2: Run the store test to verify `agentDefaults` and `resetSettings` do not exist yet**

Run: `npm run test:run -- src/settings/settings-store.test.ts`

Expected: FAIL with TypeScript/runtime errors because `agentDefaults`, `setAgentDefaults`, or `resetSettings` are missing.

- [ ] **Step 3: Add shared settings types and store support**

Create `src/settings/types.ts`:

```ts
import type { ThinkingLevel } from '../types/nodes';

export type AppView = 'canvas' | 'settings';
export type SettingsSectionId =
  | 'api-keys'
  | 'model-catalog'
  | 'defaults'
  | 'data-maintenance';

export interface AgentDefaults {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  thinkingLevel: 'off',
  systemPrompt: 'You are a helpful assistant.',
};

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
}> = [
  {
    id: 'api-keys',
    label: 'Providers & API Keys',
    description: 'Manage provider credentials stored in this browser.',
  },
  {
    id: 'model-catalog',
    label: 'Model Catalog',
    description: 'Inspect and refresh OpenRouter model discovery.',
  },
  {
    id: 'defaults',
    label: 'Defaults',
    description: 'Choose the defaults applied to newly created agents.',
  },
  {
    id: 'data-maintenance',
    label: 'Data & Maintenance',
    description: 'Import, export, reset, and load fixture data.',
  },
];
```

Update `src/settings/settings-store.ts`:

```ts
import { create } from 'zustand';
import {
  DEFAULT_AGENT_DEFAULTS,
  type AgentDefaults,
} from './types';

const STORAGE_KEY = 'agent-manager-settings';

interface PersistedSettings {
  apiKeys: Record<string, string>;
  agentDefaults: AgentDefaults;
}

interface SettingsStore extends PersistedSettings {
  setApiKey: (provider: string, key: string) => void;
  getApiKey: (provider: string) => string | undefined;
  removeApiKey: (provider: string) => void;
  setAgentDefaults: (updates: Partial<AgentDefaults>) => void;
  resetSettings: () => void;
}

function loadSettings(): PersistedSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return {
      apiKeys: parsed.apiKeys ?? {},
      agentDefaults: {
        ...DEFAULT_AGENT_DEFAULTS,
        ...(parsed.agentDefaults ?? {}),
      },
    };
  } catch {
    return {
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
    };
  }
}

function saveSettings(settings: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
```

Implement `setAgentDefaults(...)` as a shallow merge over the four approved fields and `resetSettings()` as a full return to the default persisted state.

- [ ] **Step 4: Run the store test to verify settings persistence now passes**

Run: `npm run test:run -- src/settings/settings-store.test.ts`

Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/settings/types.ts src/settings/settings-store.ts src/settings/settings-store.test.ts
git commit -m "feat: add persisted agent defaults to settings store"
```

## Task 2: Add Graph And Session Actions For Defaults And Resets

**Files:**
- Modify: `src/store/graph-store.ts`
- Modify: `src/store/session-store.ts`
- Test: `src/store/graph-store.test.ts`

- [ ] **Step 1: Write the failing graph-store tests**

Create `src/store/graph-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graph-store';
import { useSettingsStore } from '../settings/settings-store';

describe('graph store defaults integration', () => {
  beforeEach(() => {
    localStorage.clear();
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingNameNodeId: null,
    } as any);
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPrompt: 'Be concise.',
      },
    });
  });

  it('applies settings defaults when creating a new agent node', () => {
    const id = useGraphStore.getState().addNode('agent', { x: 10, y: 20 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('agent');
    if (node?.data.type === 'agent') {
      expect(node.data.provider).toBe('openai');
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Be concise.');
    }
  });

  it('does not apply agent defaults to non-agent nodes', () => {
    const id = useGraphStore.getState().addNode('tools', { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('tools');
    if (node?.data.type === 'tools') {
      expect(node.data.profile).toBe('full');
    }
  });

  it('applies only the four approved fields to existing agents', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            systemPrompt: 'Old prompt',
            description: 'keep me',
            tags: ['keep'],
            modelCapabilities: { contextWindow: 5000 },
          },
        },
      ],
    } as any);

    useGraphStore.getState().applyAgentDefaultsToExistingAgents();

    const node = useGraphStore.getState().nodes[0];
    expect(node.data.type).toBe('agent');
    if (node.data.type === 'agent') {
      expect(node.data.provider).toBe('openai');
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Be concise.');
      expect(node.data.description).toBe('keep me');
      expect(node.data.tags).toEqual(['keep']);
      expect(node.data.modelCapabilities).toEqual({ contextWindow: 5000 });
    }
  });

  it('clears graph state without touching settings defaults', () => {
    useGraphStore.setState({
      nodes: [{ id: 'x', type: 'agent' }] as any,
      edges: [{ id: 'e', source: 'x', target: 'y' }] as any,
      selectedNodeId: 'x',
      pendingNameNodeId: 'x',
    });

    useGraphStore.getState().clearGraph();

    expect(useGraphStore.getState().nodes).toEqual([]);
    expect(useGraphStore.getState().edges).toEqual([]);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
    expect(useSettingsStore.getState().agentDefaults.provider).toBe('openai');
  });
});
```

- [ ] **Step 2: Run the store test to verify the new actions are missing**

Run: `npm run test:run -- src/store/graph-store.test.ts`

Expected: FAIL because `applyAgentDefaultsToExistingAgents()` and `clearGraph()` do not exist and `addNode()` still uses only `getDefaultNodeData()`.

- [ ] **Step 3: Implement agent-default application and reset helpers**

Update `src/store/graph-store.ts`:

```ts
import { useSettingsStore } from '../settings/settings-store';

function buildNodeData(nodeType: NodeType): FlowNodeData {
  const defaults = getDefaultNodeData(nodeType);
  if (nodeType !== 'agent' || defaults.type !== 'agent') {
    return defaults;
  }

  const agentDefaults = useSettingsStore.getState().agentDefaults;
  return {
    ...defaults,
    provider: agentDefaults.provider,
    modelId: agentDefaults.modelId,
    thinkingLevel: agentDefaults.thinkingLevel,
    systemPrompt: agentDefaults.systemPrompt,
  };
}
```

Use `buildNodeData(nodeType)` inside `addNode(...)` instead of reading settings inside `getDefaultNodeData()`.

Add store actions:

```ts
applyAgentDefaultsToExistingAgents: () => {
  const agentDefaults = useSettingsStore.getState().agentDefaults;
  set({
    nodes: get().nodes.map((node) =>
      node.data.type === 'agent'
        ? {
            ...node,
            data: {
              ...node.data,
              provider: agentDefaults.provider,
              modelId: agentDefaults.modelId,
              thinkingLevel: agentDefaults.thinkingLevel,
              systemPrompt: agentDefaults.systemPrompt,
            },
          }
        : node,
    ),
  });
},
clearGraph: () => {
  set({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    pendingNameNodeId: null,
  });
},
```

Update `src/store/session-store.ts` to add a small maintenance API:

```ts
resetAllSessions: () => {
  set({
    sessions: {},
    activeSessionId: {},
  });
},
```

- [ ] **Step 4: Run the store test to verify defaults integration now passes**

Run: `npm run test:run -- src/store/graph-store.test.ts`

Expected: PASS with `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/store/graph-store.ts src/store/session-store.ts src/store/graph-store.test.ts
git commit -m "feat: add graph actions for app defaults and reset flows"
```

## Task 3: Replace The Modal With An App-Level Settings Workspace Shell

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/panels/Sidebar.tsx`
- Delete: `src/settings/SettingsModal.tsx`
- Create: `src/settings/SettingsWorkspace.tsx`
- Test: `src/App.test.tsx`
- Test: `src/settings/SettingsWorkspace.test.tsx`

- [ ] **Step 1: Write the failing UI tests for app-mode switching and settings navigation**

Create `src/App.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useGraphStore } from './store/graph-store';
import { useAgentRuntimeStore } from './store/agent-runtime-store';

vi.mock('./canvas/FlowCanvas', () => ({
  default: () => <div>Flow Canvas Stub</div>,
}));

vi.mock('./panels/PropertiesPanel', () => ({
  default: () => <div>Properties Panel Stub</div>,
}));

vi.mock('./chat/ChatDrawer', () => ({
  default: () => <div>Chat Drawer Stub</div>,
}));

describe('App settings workspace shell', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: 'agent-1',
      pendingNameNodeId: null,
    } as any);
    useAgentRuntimeStore.setState({
      chatAgentNodeId: 'agent-1',
      runningAgentIds: new Set(),
      runtimes: new Map(),
    } as any);
  });

  it('switches to settings mode without clearing selected node state', () => {
    render(
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByTitle('Settings'));

    expect(screen.queryByText('Flow Canvas Stub')).not.toBeInTheDocument();
    expect(screen.queryByText('Properties Panel Stub')).not.toBeInTheDocument();
    expect(screen.queryByText('Chat Drawer Stub')).not.toBeInTheDocument();
    expect(useGraphStore.getState().selectedNodeId).toBe('agent-1');
    expect(screen.getByText('Providers & API Keys')).toBeInTheDocument();
  });
});
```

Create `src/settings/SettingsWorkspace.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsWorkspace from './SettingsWorkspace';

describe('SettingsWorkspace', () => {
  it('shows the active section metadata', () => {
    render(
      <SettingsWorkspace
        activeSection="api-keys"
        onExit={() => {}}
      />,
    );

    expect(
      screen.getByText('Manage provider credentials stored in this browser.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the UI tests to verify the app still uses the modal flow**

Run: `npm run test:run -- src/App.test.tsx src/settings/SettingsWorkspace.test.tsx`

Expected: FAIL because `SettingsWorkspace` does not exist and `App.tsx` still renders `SettingsModal`.

- [ ] **Step 3: Implement the view-mode shell and settings workspace skeleton**

Create `src/settings/SettingsWorkspace.tsx`:

```tsx
import { ArrowLeft } from 'lucide-react';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from './types';

interface SettingsWorkspaceProps {
  activeSection: SettingsSectionId;
  onExit: () => void;
}

export default function SettingsWorkspace({
  activeSection,
  onExit,
}: SettingsWorkspaceProps) {
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === activeSection)!;

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{section.label}</h2>
          <p className="text-sm text-slate-400">{section.description}</p>
        </div>
        <button
          onClick={onExit}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
        >
          <ArrowLeft size={16} />
          Return to Canvas
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          Section content placeholder for {section.label}
        </div>
      </div>
    </div>
  );
}
```

Update `src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { AppView, SettingsSectionId } from './settings/types';
import SettingsWorkspace from './settings/SettingsWorkspace';

const [appView, setAppView] = useState<AppView>('canvas');
const [activeSettingsSection, setActiveSettingsSection] =
  useState<SettingsSectionId>('api-keys');
```

Render:

```tsx
<Sidebar
  appView={appView}
  activeSettingsSection={activeSettingsSection}
  onSettingsSectionChange={setActiveSettingsSection}
/>

<div className="relative flex-1">
  {appView === 'canvas' ? (
    <>
      <div className="absolute top-3 right-3 z-10">
        <button
          onClick={() => setAppView('settings')}
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
      <FlowCanvas />
    </>
  ) : (
    <SettingsWorkspace
      activeSection={activeSettingsSection}
      onExit={() => setAppView('canvas')}
    />
  )}
</div>
```

Only render `PropertiesPanel` and `ChatDrawer` when `appView === 'canvas'`.

Update `src/panels/Sidebar.tsx` to accept:

```ts
interface SidebarProps {
  appView: AppView;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
}
```

In settings mode, replace the palette/actions UI with a vertical list of `SETTINGS_SECTIONS`.

Delete `src/settings/SettingsModal.tsx`.

- [ ] **Step 4: Run the UI tests to verify the dedicated workspace shell works**

Run: `npm run test:run -- src/App.test.tsx src/settings/SettingsWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/panels/Sidebar.tsx src/settings/SettingsWorkspace.tsx src/App.test.tsx src/settings/SettingsWorkspace.test.tsx src/settings/types.ts
git rm src/settings/SettingsModal.tsx
git commit -m "feat: replace settings modal with workspace shell"
```

## Task 4: Implement Providers & API Keys And Model Catalog Sections

**Files:**
- Modify: `src/settings/SettingsWorkspace.tsx`
- Modify: `src/store/model-catalog-store.ts`
- Modify: `src/store/model-catalog-store.test.ts`
- Modify: `src/settings/SettingsWorkspace.test.tsx`
- Create: `src/settings/sections/ProvidersApiKeysSection.tsx`
- Create: `src/settings/sections/ModelCatalogSection.tsx`

- [ ] **Step 1: Write the failing tests for forced refresh and section rendering**

Extend `src/store/model-catalog-store.test.ts`:

```ts
it('refetches when sync is forced with the same OpenRouter key', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  const store = useModelCatalogStore.getState();
  await store.syncOpenRouterKey('same-key');
  await store.syncOpenRouterKey('same-key', { force: true });

  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

Extend `src/settings/SettingsWorkspace.test.tsx`:

```tsx
import { useSettingsStore } from './settings-store';
import { DEFAULT_AGENT_DEFAULTS } from './types';

it('renders catalog idle state when no OpenRouter key exists', () => {
  useSettingsStore.setState({
    apiKeys: {},
    agentDefaults: DEFAULT_AGENT_DEFAULTS,
  });

  render(
      <SettingsWorkspace
        activeSection="model-catalog"
        onExit={() => {}}
      />,
  );

  expect(screen.getByText(/Add an OpenRouter API key/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify the manual refresh path is missing**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts src/settings/SettingsWorkspace.test.tsx`

Expected: FAIL because `syncOpenRouterKey(..., { force: true })` is not supported and the workspace only renders placeholders.

- [ ] **Step 3: Implement the two settings sections and forced refresh support**

Update `src/store/model-catalog-store.ts`:

```ts
interface SyncOptions {
  force?: boolean;
}

syncOpenRouterKey: async (apiKey, options: SyncOptions = {}) => {
  if (!apiKey) {
    set({
      models: { openrouter: {} },
      loading: { openrouter: false },
      errors: { openrouter: null },
      lastSyncedKeys: {},
    });
    return;
  }

  if (
    !options.force &&
    get().lastSyncedKeys.openrouter === apiKey
  ) {
    return;
  }

  // existing fetch path...
},
```

Create `src/settings/sections/ProvidersApiKeysSection.tsx`:

```tsx
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../settings-store';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'groq', label: 'Groq' },
  { id: 'xai', label: 'xAI' },
  { id: 'ollama', label: 'Ollama (local)' },
];

export default function ProvidersApiKeysSection() {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const setApiKey = useSettingsStore((state) => state.setApiKey);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      {PROVIDERS.map(({ id, label }) => (
        <label key={id} className="block">
          <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
          <div className="flex gap-2">
            <input
              type={visible[id] ? 'text' : 'password'}
              value={apiKeys[id] ?? ''}
              onChange={(event) => setApiKey(id, event.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            />
            <button
              type="button"
              onClick={() =>
                setVisible((current) => ({ ...current, [id]: !current[id] }))
              }
              className="rounded-lg border border-slate-700 px-3 text-slate-300"
            >
              {visible[id] ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
      ))}
      <p className="text-xs text-slate-500">
        Keys are stored in your browser's local storage and never leave this device.
      </p>
    </div>
  );
}
```

Create `src/settings/sections/ModelCatalogSection.tsx`:

```tsx
import { RefreshCw } from 'lucide-react';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useSettingsStore } from '../settings-store';

export default function ModelCatalogSection() {
  const openRouterKey = useSettingsStore((state) => state.apiKeys.openrouter);
  const models = useModelCatalogStore((state) => state.models.openrouter);
  const loading = useModelCatalogStore((state) => state.loading.openrouter);
  const error = useModelCatalogStore((state) => state.errors.openrouter);
  const syncOpenRouterKey = useModelCatalogStore((state) => state.syncOpenRouterKey);

  const modelCount = Object.keys(models).length;

  return (
    <div className="space-y-4">
      {!openRouterKey ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Add an OpenRouter API key in Providers & API Keys to enable discovery.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          {loading ? 'Refreshing OpenRouter models…' : `Discovered ${modelCount} OpenRouter models.`}
        </div>
      )}

      <button
        type="button"
        disabled={!openRouterKey || loading}
        onClick={() => void syncOpenRouterKey(openRouterKey, { force: true })}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        <RefreshCw size={16} />
        Sync now
      </button>
    </div>
  );
}
```

Update `src/settings/SettingsWorkspace.tsx` to render the real section components instead of placeholder content.

- [ ] **Step 4: Run the tests to verify the first two sections work**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts src/settings/SettingsWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/model-catalog-store.ts src/store/model-catalog-store.test.ts src/settings/SettingsWorkspace.tsx src/settings/SettingsWorkspace.test.tsx src/settings/sections/ProvidersApiKeysSection.tsx src/settings/sections/ModelCatalogSection.tsx
git commit -m "feat: add provider keys and model catalog settings sections"
```

## Task 5: Implement The Defaults Section And Apply-To-Existing Flow

**Files:**
- Modify: `src/settings/SettingsWorkspace.tsx`
- Create: `src/settings/sections/DefaultsSection.tsx`
- Test: `src/settings/sections/DefaultsSection.test.tsx`

- [ ] **Step 1: Write the failing defaults-section tests**

Create `src/settings/sections/DefaultsSection.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultsSection from './DefaultsSection';
import { useSettingsStore } from '../settings-store';
import { useGraphStore } from '../../store/graph-store';

describe('DefaultsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        systemPrompt: 'You are a helpful assistant.',
      },
    });
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            systemPrompt: 'Old prompt',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ],
    } as any);
  });

  it('updates stored defaults when the form changes', () => {
    render(<DefaultsSection />);

    fireEvent.change(screen.getByLabelText('System Prompt'), {
      target: { value: 'New defaults prompt' },
    });

    expect(useSettingsStore.getState().agentDefaults.systemPrompt).toBe(
      'New defaults prompt',
    );
  });

  it('resets the default model when the default provider changes', () => {
    render(<DefaultsSection />);

    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: 'openai' },
    });

    expect(useSettingsStore.getState().agentDefaults.provider).toBe('openai');
    expect(useSettingsStore.getState().agentDefaults.modelId).toBe('gpt-4o');
  });

  it('requires confirmation before applying defaults to existing agents', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DefaultsSection />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply defaults to existing agents/i }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('provider, model, thinking level, and system prompt'),
    );
    expect(useGraphStore.getState().nodes[0].data.type).toBe('agent');
    if (useGraphStore.getState().nodes[0].data.type === 'agent') {
      expect(useGraphStore.getState().nodes[0].data.systemPrompt).toBe(
        'You are a helpful assistant.',
      );
    }
  });
});
```

- [ ] **Step 2: Run the defaults-section test to verify the section does not exist yet**

Run: `npm run test:run -- src/settings/sections/DefaultsSection.test.tsx`

Expected: FAIL because `DefaultsSection` does not exist and the workspace does not render a defaults form.

- [ ] **Step 3: Implement the defaults form and confirmation-gated apply action**

Create `src/settings/sections/DefaultsSection.tsx`:

```tsx
import { useGraphStore } from '../../store/graph-store';
import { STATIC_MODELS } from '../../runtime/provider-model-options';
import { useSettingsStore } from '../settings-store';
import type { ThinkingLevel } from '../../types/nodes';

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export default function DefaultsSection() {
  const agentDefaults = useSettingsStore((state) => state.agentDefaults);
  const setAgentDefaults = useSettingsStore((state) => state.setAgentDefaults);
  const applyAgentDefaultsToExistingAgents = useGraphStore(
    (state) => state.applyAgentDefaultsToExistingAgents,
  );

  const providerOptions = Object.keys(STATIC_MODELS);

  const confirmApply = () => {
    const approved = window.confirm(
      'Apply provider, model, thinking level, and system prompt to all existing agents? This does not change names, descriptions, tags, capabilities, or peripheral links.',
    );
    if (approved) {
      applyAgentDefaultsToExistingAgents();
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">Provider</span>
        <select
          aria-label="Provider"
          value={agentDefaults.provider}
          onChange={(event) => {
            const provider = event.target.value;
            setAgentDefaults({
              provider,
              modelId: STATIC_MODELS[provider]?.[0] ?? '',
            });
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">Model</span>
        <select
          aria-label="Model"
          value={agentDefaults.modelId}
          onChange={(event) =>
            setAgentDefaults({ modelId: event.target.value })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {(STATIC_MODELS[agentDefaults.provider] ?? []).map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">Thinking Level</span>
        <select
          aria-label="Thinking Level"
          value={agentDefaults.thinkingLevel}
          onChange={(event) =>
            setAgentDefaults({
              thinkingLevel: event.target.value as ThinkingLevel,
            })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">System Prompt</span>
        <textarea
          aria-label="System Prompt"
          value={agentDefaults.systemPrompt}
          onChange={(event) =>
            setAgentDefaults({ systemPrompt: event.target.value })
          }
          rows={8}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
      </label>
      <button
        type="button"
        onClick={confirmApply}
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200"
      >
        Apply defaults to existing agents
      </button>
    </div>
  );
}
```

Update `src/settings/SettingsWorkspace.tsx` so the `defaults` section renders `<DefaultsSection />`.

- [ ] **Step 4: Run the defaults-section test to verify edits and apply-confirmation work**

Run: `npm run test:run -- src/settings/sections/DefaultsSection.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/SettingsWorkspace.tsx src/settings/sections/DefaultsSection.tsx src/settings/sections/DefaultsSection.test.tsx
git commit -m "feat: add agent defaults settings section"
```

## Task 6: Implement Data & Maintenance Actions

**Files:**
- Modify: `src/settings/SettingsWorkspace.tsx`
- Create: `src/settings/sections/DataMaintenanceSection.tsx`
- Test: `src/settings/sections/DataMaintenanceSection.test.tsx`

- [ ] **Step 1: Write the failing maintenance-section tests**

Create `src/settings/sections/DataMaintenanceSection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataMaintenanceSection from './DataMaintenanceSection';
import { useGraphStore } from '../../store/graph-store';
import { useSessionStore } from '../../store/session-store';
import { useSettingsStore } from '../settings-store';

vi.mock('../../utils/export-import', () => ({
  exportGraph: vi.fn(() => ({ version: 2, exportedAt: 1, graph: {} })),
  importGraph: vi.fn(() => null),
  downloadJson: vi.fn(),
  uploadJson: vi.fn(async () => ({ invalid: true })),
}));

describe('DataMaintenanceSection', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [{ id: 'agent-1', type: 'agent' }] as any,
      edges: [],
      selectedNodeId: 'agent-1',
      pendingNameNodeId: null,
    });
    useSessionStore.setState({
      sessions: {
        s1: {
          id: 's1',
          agentName: 'Agent',
          llmSlug: 'openai/gpt-4o',
          createdAt: 1,
          lastMessageAt: 1,
          messages: [],
        },
      },
      activeSessionId: { 'agent-1': 's1' },
    } as any);
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPrompt: 'Be concise.',
      },
    });
  });

  it('shows an inline error when an imported graph is invalid', async () => {
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Import Graph/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid graph file format/i)).toBeInTheDocument();
    });
  });

  it('clears sessions only after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DataMaintenanceSection />);

    fireEvent.click(screen.getByRole('button', { name: /Clear Chat Sessions/i }));

    expect(useSessionStore.getState().sessions).toEqual({});
    expect(useSessionStore.getState().activeSessionId).toEqual({});
  });
});
```

- [ ] **Step 2: Run the maintenance-section test to verify the section does not exist yet**

Run: `npm run test:run -- src/settings/sections/DataMaintenanceSection.test.tsx`

Expected: FAIL because `DataMaintenanceSection` does not exist and the maintenance actions still live in `Sidebar.tsx`.

- [ ] **Step 3: Implement import/export and scoped reset actions inside Settings**

Create `src/settings/sections/DataMaintenanceSection.tsx`:

```tsx
import { useState } from 'react';
import testFixture from '../../fixtures/test-graph.json';
import { useGraphStore } from '../../store/graph-store';
import { useSessionStore } from '../../store/session-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import {
  downloadJson,
  exportGraph,
  importGraph,
  uploadJson,
} from '../../utils/export-import';
import { useSettingsStore } from '../settings-store';

export default function DataMaintenanceSection() {
  const [message, setMessage] = useState<string | null>(null);

  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const clearGraph = useGraphStore((state) => state.clearGraph);
  const resetAllSessions = useSessionStore((state) => state.resetAllSessions);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const resetModelCatalog = useModelCatalogStore((state) => state.reset);

  const handleImport = async () => {
    try {
      const data = await uploadJson();
      const result = importGraph(data);
      if (!result) {
        setMessage('Invalid graph file format.');
        return;
      }
      loadGraph(result.nodes, result.edges);
      setMessage('Graph imported.');
    } catch {
      setMessage('Import cancelled.');
    }
  };

  const confirmAndRun = (text: string, fn: () => void) => {
    if (window.confirm(text)) {
      fn();
      setMessage(null);
    }
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={() => downloadJson(exportGraph(nodes, edges), `agent-graph-${Date.now()}.json`)}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"
      >
        Export Graph
      </button>
      <button
        type="button"
        onClick={() => void handleImport()}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"
      >
        Import Graph
      </button>
      <button
        type="button"
        onClick={() => {
          const result = importGraph(testFixture);
          if (result) {
            loadGraph(result.nodes, result.edges);
            setMessage('Test fixture loaded.');
          }
        }}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"
      >
        Load Test Fixture
      </button>

      <button
        type="button"
        onClick={() =>
          confirmAndRun('Clear the current graph?', () => clearGraph())
        }
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
      >
        Clear Graph
      </button>
      <button
        type="button"
        onClick={() =>
          confirmAndRun('Clear all chat sessions?', () => resetAllSessions())
        }
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
      >
        Clear Chat Sessions
      </button>
      <button
        type="button"
        onClick={() =>
          confirmAndRun('Reset API keys and agent defaults?', () => {
            resetSettings();
            resetModelCatalog();
          })
        }
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
      >
        Clear App Settings
      </button>
      <button
        type="button"
        onClick={() =>
          confirmAndRun('Reset graph, sessions, settings, and model catalog?', () => {
            clearGraph();
            resetAllSessions();
            resetSettings();
            resetModelCatalog();
          })
        }
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
      >
        Reset Everything
      </button>
    </div>
  );
}
```

Update `src/settings/SettingsWorkspace.tsx` so the `data-maintenance` section renders `<DataMaintenanceSection />`.

Remove the old `Actions` block from `src/panels/Sidebar.tsx` so app-level maintenance actions live only in Settings.

- [ ] **Step 4: Run the maintenance-section test to verify errors and reset actions behave correctly**

Run: `npm run test:run -- src/settings/sections/DataMaintenanceSection.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/SettingsWorkspace.tsx src/settings/sections/DataMaintenanceSection.tsx src/settings/sections/DataMaintenanceSection.test.tsx src/panels/Sidebar.tsx
git commit -m "feat: move app maintenance actions into settings"
```

## Task 7: Full Verification And Finish

**Files:**
- Modify: any touched files only if the verification run exposes small follow-up fixes

- [ ] **Step 1: Run the focused feature tests**

Run:

```bash
npm run test:run -- src/settings/settings-store.test.ts src/store/graph-store.test.ts src/App.test.tsx src/settings/SettingsWorkspace.test.tsx src/settings/sections/DefaultsSection.test.tsx src/settings/sections/DataMaintenanceSection.test.tsx src/store/model-catalog-store.test.ts
```

Expected: PASS with all targeted tests green.

- [ ] **Step 2: Run the full build**

Run: `npm run build`

Expected: PASS with TypeScript compile and Vite build succeeding.

- [ ] **Step 3: Perform manual browser verification**

Manual checklist:

- Launch the app with `npm run dev`
- Click the gear and confirm the app enters the dedicated settings workspace
- Switch between all four settings sections from the sidebar
- Return to canvas and confirm the previous selected node still shows in the properties panel
- Add or edit API keys and refresh the OpenRouter catalog
- Change agent defaults, create a new agent, and confirm the new agent picks up the defaults
- Use `Apply defaults to existing agents` and confirm only provider/model/thinking/system prompt change
- Export a graph, import a valid graph, and try an invalid graph to confirm the inline error appears
- Clear chat sessions, clear app settings, and reset everything in a controlled test run

- [ ] **Step 4: Update docs only if implementation diverged from the approved spec**

If the implementation changes behavior materially, update:

- `docs/superpowers/specs/2026-04-03-app-settings-workspace-design.md`

Otherwise skip this step.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add app settings workspace"
```

## Notes For Execution

- Do not read user-authored settings from `getDefaultNodeData()`. Keep schema defaults and app defaults separate.
- Keep `SettingsWorkspace.tsx` focused on shell/layout; section-specific logic belongs in the individual section components.
- Treat `window.confirm(...)` as the v1 confirmation mechanism unless a task explicitly expands that UX. It satisfies the confirmed scope without introducing a full confirmation-modal subsystem.
- Keep graph import/export graph-only. Do not silently add settings or API keys to exported bundles.
- When clearing app settings, also reset the model catalog store so stale discovered data does not linger after API keys are removed.
