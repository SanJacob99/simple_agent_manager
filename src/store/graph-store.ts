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
import { saveGraph, loadGraph } from './storage';
import { useSessionStore } from './session-store';
import { useAgentConnectionStore } from './agent-connection-store';
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
    systemPromptMode: 'auto' as const,
  };
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
  clearGraph: () => void;
  setSelectedNode: (nodeId: string | null) => void;
  getSelectedNode: () => AppNode | undefined;
  setPendingNameNodeId: (nodeId: string | null) => void;

  /** Check if an agent name is already taken */
  isAgentNameTaken: (name: string, excludeNodeId?: string) => boolean;
  /** Get all agent names currently in the graph */
  getAgentNames: () => string[];

  loadGraph: (nodes: AppNode[], edges: Edge[]) => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  pendingNameNodeId: null,

  onNodesChange: (changes) => {
    for (const change of changes) {
      if (change.type === 'remove') {
        // Find the node being removed to get agent name
        const removedNode = get().nodes.find((n) => n.id === change.id);
        if (removedNode?.data.type === 'agent') {
          const agentName = (removedNode.data as { name: string }).name;
          if (agentName) {
            useSessionStore.getState().deleteAllSessionsForAgent(agentName);
          }
        }
        useSessionStore.getState().clearActiveSession(change.id);
        useAgentConnectionStore.getState().destroyAgent(change.id);
      }
    }
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    // Validate: only peripheral -> agent connections
    const { nodes } = get();
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!targetNode || targetNode.data.type !== 'agent') return;

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
        useSessionStore.getState().deleteAllSessionsForAgent(agentName);
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
        (node.data as any).systemPromptMode =
          node.data.systemPrompt === 'You are a helpful assistant.' ? 'auto' : 'append';
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
        // Add bootstrap defaults
        if (!('bootstrapMaxChars' in node.data)) {
          (node.data as any).bootstrapMaxChars = 20000;
        }
        if (!('bootstrapTotalMaxChars' in node.data)) {
          (node.data as any).bootstrapTotalMaxChars = 150000;
        }
      }
    }
    set({ nodes, edges });
  },
}));

// Auto-persist: debounce save on every state change
let saveTimeout: ReturnType<typeof setTimeout>;
useGraphStore.subscribe((state) => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveGraph({ nodes: state.nodes, edges: state.edges });
  }, 500);
});

// Load persisted graph on startup
const persisted = loadGraph();
if (persisted && persisted.nodes.length > 0) {
  useGraphStore.getState().loadGraph(persisted.nodes, persisted.edges);
}
