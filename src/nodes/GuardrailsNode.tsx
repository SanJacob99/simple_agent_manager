import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { ShieldAlert } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { GuardrailsNodeData } from '../types/nodes';

type GuardrailsNode = Node<GuardrailsNodeData>;

function GuardrailsNodeComponent({ data, selected }: NodeProps<GuardrailsNode>) {
  return (
    <BasePeripheralNode
      nodeType="guardrails"
      label={data.label}
      icon={<ShieldAlert size={22} />}
      selected={selected}
    />
  );
}

export default memo(GuardrailsNodeComponent);
