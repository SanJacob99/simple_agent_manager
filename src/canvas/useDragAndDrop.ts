import { useCallback, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graph-store';
import type { NodeType } from '../types/nodes';
import {
  buildOccupiedCellSet,
  snapNodePositionToFreeCell,
} from '../utils/hex-snap';
import { HEX_HEIGHT, HEX_WIDTH } from '../nodes/HexNode';

export function useDragAndDrop() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useGraphStore((s) => s.addNode);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData(
        'application/reactflow',
      ) as NodeType;
      if (!nodeType) return;

      const cursor = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const topLeft = {
        x: cursor.x - HEX_WIDTH / 2,
        y: cursor.y - HEX_HEIGHT / 2,
      };
      const occupied = buildOccupiedCellSet(useGraphStore.getState().nodes);
      const { position } = snapNodePositionToFreeCell(topLeft, occupied);

      addNode(nodeType, position);
    },
    [screenToFlowPosition, addNode],
  );

  return { onDragOver, onDrop };
}
