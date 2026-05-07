import type { Edge } from '@xyflow/react';
import type { NodeType, FlowNodeData } from './nodes';

/**
 * A reusable group of nodes captured from the canvas. Templates are saved
 * as plain JSON and re-inserted with fresh IDs and uniqueness-safe paths
 * so two instances never silently share storage directories or working
 * directories. See `src/utils/clone-nodes.ts` for the fixup rules.
 *
 * Template nodes/edges keep their *original* IDs at save time. Those IDs
 * are local to the template and get remapped to fresh IDs on insert; the
 * point of preserving them is to keep edge wiring intact.
 */
export interface TemplateNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
}

export interface NodeTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

export const TEMPLATE_DRAG_MIME = 'application/x-sam-template-id';
