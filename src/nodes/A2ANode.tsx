import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Waypoints } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { A2ANodeData } from '../types/nodes';

type A2ANode = Node<A2ANodeData>;

function A2ANodeComponent({ data, selected }: NodeProps<A2ANode>) {
  return (
    <BasePeripheralNode
      nodeType="a2a"
      label={data.label}
      icon={<Waypoints size={22} />}
      selected={selected}
    />
  );
}

export default memo(A2ANodeComponent);
