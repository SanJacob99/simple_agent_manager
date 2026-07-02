import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Box } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { SandboxNodeData } from '../types/nodes';

type SandboxNode = Node<SandboxNodeData>;

function SandboxNodeComponent({ data, selected }: NodeProps<SandboxNode>) {
  return (
    <BasePeripheralNode
      nodeType="sandbox"
      label={data.label}
      icon={<Box size={22} />}
      selected={selected}
    />
  );
}

export default memo(SandboxNodeComponent);
