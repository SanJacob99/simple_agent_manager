import { useCallback, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graph-store';
import type { NodeType } from '../types/nodes';

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

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(nodeType, position);
    },
    [screenToFlowPosition, addNode],
  );

  return { onDragOver, onDrop };
}
