import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Container } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { VectorDatabaseNodeData } from '../types/nodes';

type VectorDatabaseNode = Node<VectorDatabaseNodeData>;

function VectorDatabaseNodeComponent({ data, selected }: NodeProps<VectorDatabaseNode>) {
  return (
    <BasePeripheralNode
      nodeType="vectorDatabase"
      label={data.label}
      icon={<Container size={14} />}
      selected={selected}
    >
      <div>Provider: {data.provider}</div>
      <div>Collection: {data.collectionName}</div>
    </BasePeripheralNode>
  );
}

export default memo(VectorDatabaseNodeComponent);
