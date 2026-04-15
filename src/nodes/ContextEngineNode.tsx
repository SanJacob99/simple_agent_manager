import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BookOpen } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ContextEngineNodeData } from '../types/nodes';
import { useContextEngineSync } from './useContextEngineSync';

type ContextEngineNode = Node<ContextEngineNodeData>;

function ContextEngineNodeComponent({ id, data, selected }: NodeProps<ContextEngineNode>) {
  // Sync context window capabilities down to the node data continuously while the node is mounted
  useContextEngineSync(id, data);

  return (
    <BasePeripheralNode
      nodeType="contextEngine"
      label={data.label}
      icon={<BookOpen size={22} />}
      selected={selected}
    />
  );
}

export default memo(ContextEngineNodeComponent);
