import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Blocks } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { VectorDatabaseNodeData } from '../types/nodes';

type VectorDatabaseNode = Node<VectorDatabaseNodeData>;

function VectorDatabaseNodeComponent({ data, selected }: NodeProps<VectorDatabaseNode>) {
  return (
    <BasePeripheralNode
      nodeType="vectorDatabase"
      label={data.label}
      icon={<Blocks size={22} />}
      selected={selected}
    />
  );
}

export default memo(VectorDatabaseNodeComponent);
