import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { ClipboardCheck } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { EvalsNodeData } from '../types/nodes';

type EvalsNode = Node<EvalsNodeData>;

function EvalsNodeComponent({ data, selected }: NodeProps<EvalsNode>) {
  return (
    <BasePeripheralNode
      nodeType="evals"
      label={data.label}
      icon={<ClipboardCheck size={22} />}
      selected={selected}
    />
  );
}

export default memo(EvalsNodeComponent);
