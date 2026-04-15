import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useStore,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { NODE_COLORS } from '../utils/theme';
import type { NodeType } from '../types/nodes';

type DataEdgeData = { label?: string };
type DataEdge = Edge<DataEdgeData, 'data'>;

function DataEdgeComponent({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<DataEdge>) {
  const { setEdges } = useReactFlow();
  const sourceNodeType = useStore(
    (s) => s.nodeLookup.get(source)?.type as NodeType | undefined,
  );
  const strokeColor = sourceNodeType
    ? NODE_COLORS[sourceNodeType]
    : 'var(--c-slate-600)';
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDelete = useCallback(() => {
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  }, [id, setEdges]);

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            onClick={onDelete}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-slate-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-400 [.react-flow__edge:hover+*_&]:opacity-100"
            style={{ opacity: undefined }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = {
  data: DataEdgeComponent,
} as const;
