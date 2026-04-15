import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  type IsValidConnection,
  type MiniMapNodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useGraphStore } from '../store/graph-store';
import { nodeTypes } from '../nodes/node-registry';
import { edgeTypes } from '../edges/DataEdge';
import { useDragAndDrop } from './useDragAndDrop';
import LottieAnimation from '../components/LottieAnimation';
import HelloSquid from '../animations/HelloSquid.json';
import { cssVar } from '../utils/css-var';
import HoneycombBackground from './HoneycombBackground';
import SnapHighlight from './SnapHighlight';
import {
  HEX_CORNER_RADIUS,
  HEX_SIDE,
  roundedHexPathPointyTop,
} from '../nodes/HexNode';
import {
  axialToPixel,
  buildOccupiedCellSet,
  nodeTopLeftToAxial,
  findNearestFreeCell,
  axialToNodeTopLeft,
} from '../utils/hex-snap';
import { NODE_COLORS } from '../utils/theme';
import type { NodeType } from '../types/nodes';

const SQRT3 = Math.sqrt(3);

function HexMiniMapNode({
  x,
  y,
  width,
  height,
  color,
  strokeColor,
  strokeWidth,
  style,
  className,
  onClick,
  id,
}: MiniMapNodeProps) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const side = Math.min(width / SQRT3, height / 2);
  const radius = Math.min(HEX_CORNER_RADIUS, side / 2);

  return (
    <path
      className={className}
      d={roundedHexPathPointyTop(cx, cy, side, radius)}
      fill={color}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      style={style}
      onClick={onClick ? (event) => onClick(event, id) : undefined}
    />
  );
}

export default function FlowCanvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const { onDragOver, onDrop } = useDragAndDrop();

  const [snapPreview, setSnapPreview] = useState<{
    center: { x: number; y: number };
    color: string;
  } | null>(null);

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      // Only allow connections TO agent nodes
      const targetNode = nodes.find((n) => n.id === connection.target);
      return targetNode?.data.type === 'agent';
    },
    [nodes],
  );

  const onNodeDrag: NodeMouseHandler = useCallback(
    (_event, node) => {
      const target = nodeTopLeftToAxial(node.position);
      const occupied = buildOccupiedCellSet(nodes, node.id);
      const freeCell = findNearestFreeCell(target, occupied);
      const center = axialToPixel(freeCell);
      const nodeType = node.data.type as NodeType;
      setSnapPreview({ center, color: NODE_COLORS[nodeType] });
    },
    [nodes],
  );

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSnapPreview(null);
      const target = nodeTopLeftToAxial(node.position);
      const occupied = buildOccupiedCellSet(nodes, node.id);
      const freeCell = findNearestFreeCell(target, occupied);
      const snapped = axialToNodeTopLeft(freeCell);
      if (snapped.x === node.position.x && snapped.y === node.position.y) return;
      onNodesChange([
        {
          type: 'position',
          id: node.id,
          position: snapped,
          dragging: false,
        },
      ]);
    },
    [nodes, onNodesChange],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_e, node) => setSelectedNode(node.id)}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
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
      <HoneycombBackground
        side={HEX_SIDE}
        color={cssVar('--c-canvas-pattern')}
        bgColor={cssVar('--c-canvas-bg')}
        gutter={2}
      />
      <SnapHighlight
        center={snapPreview?.center ?? null}
        color={snapPreview?.color ?? null}
      />
      <Controls className="!border-slate-700 !bg-slate-800" />
      <MiniMap
        className="!border-slate-700 !bg-slate-900"
        nodeColor={(node) =>
          NODE_COLORS[(node.data as { type: NodeType }).type]
        }
        nodeStrokeColor={cssVar('--c-slate-900')}
        nodeStrokeWidth={2}
        nodeComponent={HexMiniMapNode}
        maskColor={cssVar('--c-minimap-mask')}
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
