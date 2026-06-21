import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { ClipboardCheck } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { EvaluationNodeData } from '../types/nodes';

type EvaluationNode = Node<EvaluationNodeData>;

function EvaluationNodeComponent({ data, selected }: NodeProps<EvaluationNode>) {
  return (
    <BasePeripheralNode
      nodeType="evaluation"
      label={data.label}
      icon={<ClipboardCheck size={22} />}
      selected={selected}
    />
  );
}

export default memo(EvaluationNodeComponent);
