import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Cpu } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ProviderNodeData } from '../types/nodes';

type ProviderNode = Node<ProviderNodeData>;

function ProviderNodeComponent({ data, selected }: NodeProps<ProviderNode>) {
  return (
    <BasePeripheralNode
      nodeType="provider"
      label={data.label}
      icon={<Cpu size={22} />}
      selected={selected}
    />
  );
}

export default memo(ProviderNodeComponent);
