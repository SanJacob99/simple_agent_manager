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
import { useChatStore } from './chat-store';
import { useAgentRuntimeStore } from './agent-runtime-store';

interface GraphStore {
  nodes: AppNode[];
  edges: Edge[];
  selectedNodeId: string | null;

  onNodesChange: OnNodesChange<AppNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (nodeType: NodeType, position: XYPosition) => string;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  getSelectedNode: () => AppNode | undefined;

  loadGraph: (nodes: AppNode[], edges: Edge[]) => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,

  onNodesChange: (changes) => {
    for (const change of changes) {
      if (change.type === 'remove') {
        useChatStore.getState().clearChat(change.id);
        useAgentRuntimeStore.getState().destroyRuntime(change.id);
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
      data: getDefaultNodeData(nodeType),
    };
    set({ nodes: [...get().nodes, newNode] });
    return id;
  },

  removeNode: (nodeId) => {
    useChatStore.getState().clearChat(nodeId);
    useAgentRuntimeStore.getState().destroyRuntime(nodeId);
    
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

  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  getSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find((n) => n.id === selectedNodeId);
  },

  loadGraph: (nodes, edges) => {
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
