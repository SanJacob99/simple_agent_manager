import type { Edge } from '@xyflow/react';
import type { AppNode } from './nodes';

export interface GraphState {
  nodes: AppNode[];
  edges: Edge[];
}

export interface SerializedGraph {
  id: string;
  version: number;
  graph: GraphState;
  updatedAt: number;
}
