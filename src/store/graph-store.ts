import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type XYPosition,
} from '@xyflow/react';
import type { AppNode, FlowNodeData, NodeType } from '../types/nodes';
import { createNodeId } from '../utils/id';
import { getDefaultNodeData } from '../utils/default-nodes';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import { StorageClient } from '../runtime/storage-client';
import {
  saveGraph,
  loadGraphRaw,
  fetchGraphFromServer,
  saveGraphToServer,
} from './storage';
import { useSessionStore } from './session-store';
import { useAgentConnectionStore } from './agent-connection-store';
import { useSettingsStore } from '../settings/settings-store';
import type { WorkflowPatch, GraphSnapshot } from '../../shared/sam-agent/workflow-patch';
import { redactGraphSnapshot } from '../../shared/sam-agent/workflow-patch';

function buildNodeData(nodeType: NodeType): FlowNodeData {
  const defaults = getDefaultNodeData(nodeType);

  if (nodeType === 'agent' && defaults.type === 'agent') {
    const agentDefaults = useSettingsStore.getState().agentDefaults;
    return {
      ...defaults,
      modelId: agentDefaults.modelId,
      thinkingLevel: agentDefaults.thinkingLevel,
      systemPrompt: agentDefaults.systemPrompt,
      systemPromptMode: agentDefaults.systemPromptMode,
    };
  }

  if (nodeType === 'provider' && defaults.type === 'provider') {
    const providerDefaults = useSettingsStore.getState().providerDefaults;
    return {
      ...defaults,
      pluginId: providerDefaults.pluginId,
      authMethodId: providerDefaults.authMethodId,
      envVar: providerDefaults.envVar,
      baseUrl: providerDefaults.baseUrl,
    };
  }

  if (nodeType === 'storage' && defaults.type === 'storage') {
    const storageDefaults = useSettingsStore.getState().storageDefaults;
    return {
      ...defaults,
      storagePath: storageDefaults.storagePath,
      sessionRetention: storageDefaults.sessionRetention,
      memoryEnabled: storageDefaults.memoryEnabled,
      maintenanceMode: storageDefaults.maintenanceMode,
      pruneAfterDays: storageDefaults.pruneAfterDays,
    };
  }

  if (nodeType === 'contextEngine' && defaults.type === 'contextEngine') {
    const ceDefaults = useSettingsStore.getState().contextEngineDefaults;
    return {
      ...defaults,
      tokenBudget: ceDefaults.tokenBudget,
      reservedForResponse: ceDefaults.reservedForResponse,
      compactionStrategy: ceDefaults.compactionStrategy,
      compactionThreshold: ceDefaults.compactionThreshold,
      ragEnabled: ceDefaults.ragEnabled,
      ragTopK: ceDefaults.ragTopK,
      ragMinScore: ceDefaults.ragMinScore,
    };
  }

  if (nodeType === 'memory' && defaults.type === 'memory') {
    const memDefaults = useSettingsStore.getState().memoryDefaults;
    return {
      ...defaults,
      backend: memDefaults.backend,
      maxSessionMessages: memDefaults.maxSessionMessages,
      persistAcrossSessions: memDefaults.persistAcrossSessions,
      compactionEnabled: memDefaults.compactionEnabled,
    };
  }

  if (nodeType === 'cron' && defaults.type === 'cron') {
    const cronDefaults = useSettingsStore.getState().cronDefaults;
    return {
      ...defaults,
      schedule: cronDefaults.schedule,
      sessionMode: cronDefaults.sessionMode,
      timezone: cronDefaults.timezone,
      maxRunDurationMs: cronDefaults.maxRunDurationMs,
      retentionDays: cronDefaults.retentionDays,
    };
  }

  return defaults;
}

interface GraphStore {
  nodes: AppNode[];
  edges: Edge[];
  selectedNodeId: string | null;
  /** Node ID of an agent that needs naming (dialog pending) */
  pendingNameNodeId: string | null;

  onNodesChange: OnNodesChange<AppNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (nodeType: NodeType, position: XYPosition) => string;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  applyAgentDefaultsToExistingAgents: () => void;
  applyStorageDefaultsToExistingNodes: () => void;
  clearGraph: () => void;
  setSelectedNode: (nodeId: string | null) => void;
  getSelectedNode: () => AppNode | undefined;
  setPendingNameNodeId: (nodeId: string | null) => void;

  /** Check if an agent name is already taken */
  isAgentNameTaken: (name: string, excludeNodeId?: string) => boolean;
  /** Get all agent names currently in the graph */
  getAgentNames: () => string[];

  pendingDeleteAgent: { nodeId: string; agentName: string } | null;
  requestDeleteAgent: (nodeId: string, agentName: string) => void;
  confirmDeleteAgent: (deleteData: boolean) => void;
  cancelDeleteAgent: () => void;

  loadGraph: (nodes: AppNode[], edges: Edge[]) => void;

  applyPatch: (patch: WorkflowPatch) => { ok: true } | { ok: false; error: string };
  buildGraphSnapshot: () => GraphSnapshot;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  pendingNameNodeId: null,
  pendingDeleteAgent: null,

  requestDeleteAgent: (nodeId, agentName) => {
    set({ pendingDeleteAgent: { nodeId, agentName } });
  },

  cancelDeleteAgent: () => {
    set({ pendingDeleteAgent: null });
  },

  confirmDeleteAgent: (deleteData) => {
    const { pendingDeleteAgent, nodes, edges, selectedNodeId } = get();
    if (!pendingDeleteAgent) return;

    // Destroy the runtime BEFORE any storage delete so the WS teardown
    // reaches the server before the HTTP DELETE; otherwise in-flight
    // transcript writes can recreate the directory after rm. The backend
    // also enforces this, but ordering here keeps the race window small.
    useAgentConnectionStore.getState().destroyAgent(pendingDeleteAgent.nodeId);
    useSessionStore.getState().clearActiveSession(pendingDeleteAgent.nodeId);

    if (deleteData) {
      const config = resolveAgentConfig(pendingDeleteAgent.nodeId, nodes, edges);
      if (config?.storage) {
        const client = new StorageClient(
          config.storage,
          pendingDeleteAgent.agentName,
          pendingDeleteAgent.nodeId,
        );
        void client.init()
          .then(() => client.deleteAgentData())
          .catch(console.error);
      }
      useSessionStore.getState().deleteAllSessionsForAgent(pendingDeleteAgent.nodeId);
    }

    set({
      pendingDeleteAgent: null,
      nodes: nodes.filter((n) => n.id !== pendingDeleteAgent.nodeId),
      edges: edges.filter(
        (e) => e.source !== pendingDeleteAgent.nodeId && e.target !== pendingDeleteAgent.nodeId,
      ),
      selectedNodeId: selectedNodeId === pendingDeleteAgent.nodeId ? null : selectedNodeId,
    });
  },

  onNodesChange: (changes) => {
    const nextChanges = [];
    
    for (const change of changes) {
      if (change.type === 'remove') {
        // Find the node being removed to get agent name
        const removedNode = get().nodes.find((n) => n.id === change.id);
        if (removedNode?.data.type === 'agent') {
          const agentName = (removedNode.data as { name: string }).name;
          if (agentName) {
            get().requestDeleteAgent(change.id, agentName);
            continue; // Intercept removal! Don't apply this change to the graph yet
          }
        }
        
        useSessionStore.getState().clearActiveSession(change.id);
        useAgentConnectionStore.getState().destroyAgent(change.id);
      }
      nextChanges.push(change);
    }
    set({ nodes: applyNodeChanges(nextChanges, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    // Peripheral -> agent. Sub-agents are also valid targets so users can
    // attach a dedicated Tools / Provider / Skills / MCP to a sub-agent
    // (the resolver supports per-sub overrides).
    const { nodes } = get();
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!targetNode) return;
    const isAgent = targetNode.data.type === 'agent';
    const isSubAgent = targetNode.data.type === 'subAgent';
    if (!isAgent && !isSubAgent) return;

    // Sub-agent peripherals are limited to the four nodes the resolver
    // actually reads: tools, provider, skills, mcp. Anything else would
    // be silently ignored, which is worse than refusing the connection.
    if (isSubAgent) {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const allowed = new Set(['tools', 'provider', 'skills', 'mcp']);
      if (!sourceNode || !allowed.has(sourceNode.data.type)) return;
    }

    const edge: Edge = {
      ...connection,
      id: `edge_${connection.source}_${connection.target}`,
      type: 'data',
      animated: true,
    };
    set({ edges: addEdge(edge, get().edges) });
  },

  addNode: (nodeType, position) => {
    const id = createNodeId();
    const newNode: AppNode = {
      id,
      type: nodeType,
      position,
      data: buildNodeData(nodeType),
    };
    set({ nodes: [...get().nodes, newNode] });

    // If this is an agent node, trigger the naming dialog
    if (nodeType === 'agent') {
      set({ pendingNameNodeId: id });
    }

    return id;
  },

  removeNode: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (node?.data.type === 'agent') {
      const agentName = (node.data as { name: string }).name;
      if (agentName) {
        get().requestDeleteAgent(nodeId, agentName);
        return; // Wait for dialog confirmation
      }
    }
    useSessionStore.getState().clearActiveSession(nodeId);
    useAgentConnectionStore.getState().destroyAgent(nodeId);

    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId:
        get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } as FlowNodeData }
          : node,
      ),
    });
  },

  applyPatch: (patch: WorkflowPatch): { ok: true } | { ok: false; error: string } => {
    // Zustand state is immutable; capturing the array references is enough for rollback.
    const snapshotNodes = get().nodes;
    const snapshotEdges = get().edges;
    try {
      const tempIdToFinalId = new Map<string, string>();

      const newNodes: AppNode[] = patch.add_nodes.map((add) => {
        const id = createNodeId();
        tempIdToFinalId.set(add.tempId, id);
        const defaults = getDefaultNodeData(add.type);
        // Trusts the validator (server/sam-agent/sam-agent-validators.ts) for shape.
        const data = { ...defaults, ...add.data, type: add.type } as FlowNodeData;
        return {
          id,
          type: add.type,
          position: add.position ?? { x: 0, y: 0 },
          data,
        };
      });

      const removedSet = new Set(patch.remove_nodes);
      const removedEdgeSet = new Set(patch.remove_edges);

      const updatedNodes = snapshotNodes
        .filter((n) => !removedSet.has(n.id))
        .map((n) => {
          const upd = patch.update_nodes.find((u) => u.id === n.id);
          if (!upd) return n;
          return { ...n, data: { ...n.data, ...upd.dataPatch } as FlowNodeData };
        });

      const resolveEndpoint = (raw: string): string => tempIdToFinalId.get(raw) ?? raw;

      const newEdges: Edge[] = patch.add_edges.map((e) => {
        const source = resolveEndpoint(e.source);
        const target = resolveEndpoint(e.target);
        return {
          id: `edge_${source}_${target}`,
          source,
          target,
          type: 'data',
          animated: true,
        };
      });

      const filteredEdges = snapshotEdges
        .filter((e) => !removedEdgeSet.has(e.id))
        .filter((e) => !removedSet.has(e.source) && !removedSet.has(e.target));

      set({
        nodes: [...updatedNodes, ...newNodes],
        edges: [...filteredEdges, ...newEdges],
      });

      // Cross-store cleanup runs AFTER set() so a subscriber throw during commit
      // doesn't strand half the cleanup. destroyAgent / clearActiveSession are
      // teardowns and cannot be undone by the catch block.
      for (const removedId of patch.remove_nodes) {
        useSessionStore.getState().clearActiveSession(removedId);
        useAgentConnectionStore.getState().destroyAgent(removedId);
      }
      return { ok: true };
    } catch (err) {
      set({ nodes: snapshotNodes, edges: snapshotEdges });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  buildGraphSnapshot: (): GraphSnapshot => {
    const { nodes, edges } = get();
    return redactGraphSnapshot({
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  },

  applyAgentDefaultsToExistingAgents: () => {
    const agentDefaults = useSettingsStore.getState().agentDefaults;
    set({
      nodes: get().nodes.map((node) =>
        node.data.type === 'agent'
          ? {
              ...node,
              data: {
                ...node.data,
                modelId: agentDefaults.modelId,
                thinkingLevel: agentDefaults.thinkingLevel,
              },
            }
          : node,
      ),
    });
  },

  applyStorageDefaultsToExistingNodes: () => {
    const storageDefaults = useSettingsStore.getState().storageDefaults;
    set({
      nodes: get().nodes.map((node) =>
        node.data.type === 'storage'
          ? {
              ...node,
              data: {
                ...node.data,
                storagePath: storageDefaults.storagePath,
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

  setSelectedNode: (nodeId) => {
    if (nodeId) {
      useAgentConnectionStore.getState().closeChatDrawer();
    }
    set({ selectedNodeId: nodeId });
  },

  getSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find((n) => n.id === selectedNodeId);
  },

  setPendingNameNodeId: (nodeId) => {
    set({ pendingNameNodeId: nodeId });
  },

  isAgentNameTaken: (name, excludeNodeId) => {
    const { nodes } = get();
    return nodes.some(
      (n) =>
        n.id !== excludeNodeId &&
        n.data.type === 'agent' &&
        (n.data as { name: string; nameConfirmed?: boolean }).nameConfirmed &&
        (n.data as { name: string }).name.toLowerCase() === name.toLowerCase(),
    );
  },

  getAgentNames: () => {
    const { nodes } = get();
    return nodes
      .filter(
        (n) =>
          n.data.type === 'agent' &&
          (n.data as { name: string; nameConfirmed?: boolean }).nameConfirmed &&
          (n.data as { name: string }).name,
      )
      .map((n) => (n.data as { name: string }).name);
  },

  loadGraph: (nodes, edges) => {
    // Migration: add systemPromptMode to agent nodes that don't have it
    for (const node of nodes) {
      if (node.data.type === 'agent' && !('systemPromptMode' in node.data)) {
        const agentData = node.data as import('../types/nodes').AgentNodeData;
        (agentData as any).systemPromptMode =
          agentData.systemPrompt === 'You are a helpful assistant.' ? 'auto' : 'append';
      }
      if (node.data.type === 'contextEngine') {
        // Migrate systemPromptAdditions to connected agent's append mode
        const additions = (node.data as any).systemPromptAdditions;
        if (Array.isArray(additions) && additions.length > 0) {
          const edge = edges.find(e => e.source === node.id);
          if (edge) {
            const agentNode = nodes.find(n => n.id === edge.target && n.data.type === 'agent');
            if (agentNode && agentNode.data.type === 'agent') {
              (agentNode.data as any).systemPromptMode = 'append';
              agentNode.data.systemPrompt += '\n\n' + additions.join('\n\n');
            }
          }
        }
        delete (node.data as any).systemPromptAdditions;
        // Drop the old bootstrap-limit fields and seed the new
        // post-compaction target on graphs that predate them.
        delete (node.data as any).bootstrapMaxChars;
        delete (node.data as any).bootstrapTotalMaxChars;
        if (!('postCompactionTokenTarget' in node.data)) {
          (node.data as any).postCompactionTokenTarget = 50000;
        }
      }
    }
    set({ nodes, edges });
  },
}));

// Hydration gate. The auto-save subscription below skips writes until
// the boot sequence finishes resolving the backend copy, so we never
// stomp the upstream graph with whatever transient state the store had
// during initial render.
let isHydrated = false;

// Auto-persist: debounce save on every state change. Writes to BOTH
// the backend (authoritative) and localStorage (offline cache). The
// 500ms debounce keeps high-frequency drag/resize updates from
// hammering the server.
let saveTimeout: ReturnType<typeof setTimeout>;
useGraphStore.subscribe((state) => {
  if (!isHydrated) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const graph = { nodes: state.nodes, edges: state.edges };
    saveGraph(graph);
    void saveGraphToServer(graph);
  }, 500);
});

// Boot sequence:
// 1. Apply the localStorage cache immediately so the canvas paints
//    fast, even if the backend is slow or unreachable.
// 2. Fetch the backend copy. If present, it wins (server is the
//    source of truth on conflict). If absent, push the localStorage
//    copy up so the server gets seeded on first run.
// 3. Flip `isHydrated` so subsequent edits start auto-saving.
async function hydrateGraph(): Promise<void> {
  const local = loadGraphRaw();
  if (local && local.graph.nodes.length > 0) {
    useGraphStore.getState().loadGraph(local.graph.nodes, local.graph.edges);
  }

  const server = await fetchGraphFromServer();
  if (server && server.graph.nodes.length > 0) {
    useGraphStore.getState().loadGraph(server.graph.nodes, server.graph.edges);
    // Mirror the authoritative copy into localStorage so an offline
    // boot picks up where the last sync left off.
    saveGraph(server.graph);
  } else if (local && local.graph.nodes.length > 0) {
    // Migration: backend has nothing yet, but the user already has a
    // canvas in this browser. Seed the server.
    void saveGraphToServer(local.graph);
  }

  isHydrated = true;
}

void hydrateGraph();
