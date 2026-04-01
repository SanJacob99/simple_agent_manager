import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type IsValidConnection,
} from '@xyflow/react';
import { useGraphStore } from '../store/graph-store';
import { nodeTypes } from '../nodes/node-registry';
import { edgeTypes } from '../edges/DataEdge';
import { useDragAndDrop } from './useDragAndDrop';

export default function FlowCanvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const { onDragOver, onDrop } = useDragAndDrop();

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      // Only allow connections TO agent nodes
      const targetNode = nodes.find((n) => n.id === connection.target);
      return targetNode?.data.type === 'agent';
    },
    [nodes],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_e, node) => setSelectedNode(node.id)}
      onPaneClick={() => setSelectedNode(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      isValidConnection={isValidConnection}
      onDragOver={onDragOver}
      onDrop={onDrop}
      fitView
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'data', animated: true }}
      className="bg-slate-950"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#1e293b"
      />
      <Controls className="!border-slate-700 !bg-slate-800" />
      <MiniMap
        className="!border-slate-700 !bg-slate-900"
        nodeColor="#334155"
        maskColor="#0f172a80"
      />
    </ReactFlow>
  );
}
