import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { RefreshCw } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ReflectionNodeData } from '../types/nodes';

type ReflectionNode = Node<ReflectionNodeData>;

function ReflectionNodeComponent({ data, selected }: NodeProps<ReflectionNode>) {
  return (
    <BasePeripheralNode
      nodeType="reflection"
      label={data.label}
      icon={<RefreshCw size={22} />}
      selected={selected}
    />
  );
}

export default memo(ReflectionNodeComponent);
