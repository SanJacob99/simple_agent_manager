import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BookOpen } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ContextEngineNodeData } from '../types/nodes';

type ContextEngineNode = Node<ContextEngineNodeData>;

function ContextEngineNodeComponent({ data, selected }: NodeProps<ContextEngineNode>) {
  return (
    <BasePeripheralNode
      nodeType="contextEngine"
      label={data.label}
      icon={<BookOpen size={14} />}
      selected={selected}
    >
      <div>Strategy: {data.strategy}</div>
      <div>Max tokens: {data.maxTokens.toLocaleString()}</div>
    </BasePeripheralNode>
  );
}

export default memo(ContextEngineNodeComponent);
