import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Zap } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { TriggerNodeData } from '../types/nodes';

type TriggerNode = Node<TriggerNodeData>;

function TriggerNodeComponent({ data, selected }: NodeProps<TriggerNode>) {
  return (
    <BasePeripheralNode
      nodeType="trigger"
      label={data.label}
      icon={<Zap size={22} />}
      selected={selected}
    />
  );
}

export default memo(TriggerNodeComponent);
