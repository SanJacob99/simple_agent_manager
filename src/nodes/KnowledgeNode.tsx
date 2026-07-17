import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Library } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { KnowledgeNodeData } from '../types/nodes';

type KnowledgeNode = Node<KnowledgeNodeData>;

function KnowledgeNodeComponent({ data, selected }: NodeProps<KnowledgeNode>) {
  return (
    <BasePeripheralNode
      nodeType="knowledge"
      label={data.label}
      icon={<Library size={22} />}
      selected={selected}
    />
  );
}

export default memo(KnowledgeNodeComponent);
