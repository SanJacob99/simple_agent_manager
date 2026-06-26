import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Braces } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { StructuredOutputNodeData } from '../types/nodes';

type StructuredOutputNode = Node<StructuredOutputNodeData>;

function StructuredOutputNodeComponent({ data, selected }: NodeProps<StructuredOutputNode>) {
  return (
    <BasePeripheralNode
      nodeType="structuredOutput"
      label={data.label}
      icon={<Braces size={22} />}
      selected={selected}
    />
  );
}

export default memo(StructuredOutputNodeComponent);
