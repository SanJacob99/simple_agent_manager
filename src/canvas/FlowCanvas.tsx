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
import LottieAnimation from '../components/LottieAnimation';
import HelloSquid from '../animations/HelloSquid.json';

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
      className="bg-canvas-bg"
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
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <LottieAnimation animationData={HelloSquid} size={220} />
          <p className="text-sm text-slate-500">Drag an agent onto the canvas to get started</p>
        </div>
      )}
    </ReactFlow>
  );
}
