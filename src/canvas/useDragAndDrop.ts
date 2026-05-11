import { useCallback, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graph-store';
import { useTemplateStore } from '../store/template-store';
import type { NodeType } from '../types/nodes';
import { TEMPLATE_DRAG_MIME } from '../types/templates';
import {
  buildOccupiedCellSet,
  snapNodePositionToFreeCell,
} from '../utils/hex-snap';
import { HEX_HEIGHT, HEX_WIDTH } from '../nodes/HexNode';

export function useDragAndDrop() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useGraphStore((s) => s.addNode);
  const insertTemplate = useGraphStore((s) => s.insertTemplate);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      // Template drag wins over a single-node drag — they're mutually
      // exclusive in practice (one MIME type or the other).
      const templateId = event.dataTransfer.getData(TEMPLATE_DRAG_MIME);
      if (templateId) {
        const template = useTemplateStore.getState().getTemplate(templateId);
        if (!template) return;
        const cursor = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        const topLeft = {
          x: cursor.x - HEX_WIDTH / 2,
          y: cursor.y - HEX_HEIGHT / 2,
        };
        insertTemplate(template, topLeft);
        return;
      }

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
    [screenToFlowPosition, addNode, insertTemplate],
  );

  return { onDragOver, onDrop };
}
