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
      icon={<BrainCircuit size={14} />}
      selected={selected}
    >
      <div>{data.backend} / {data.maxSessionMessages} msgs</div>
      <div>{data.persistAcrossSessions ? 'Persistent' : 'Session only'}</div>
    </BasePeripheralNode>
  );
}

export default memo(MemoryNodeComponent);
