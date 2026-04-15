import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { BrainCircuit } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { MemoryNodeData } from '../types/nodes';

type MemoryNode = Node<MemoryNodeData>;

function MemoryNodeComponent({ data, selected }: NodeProps<MemoryNode>) {
  return (
    <BasePeripheralNode
      nodeType="memory"
      label={data.label}
      icon={<BrainCircuit size={22} />}
      selected={selected}
    />
  );
}

export default memo(MemoryNodeComponent);
