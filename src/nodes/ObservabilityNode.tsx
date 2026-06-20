import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Activity } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ObservabilityNodeData } from '../types/nodes';

type ObservabilityNode = Node<ObservabilityNodeData>;

function ObservabilityNodeComponent({ data, selected }: NodeProps<ObservabilityNode>) {
  return (
    <BasePeripheralNode
      nodeType="observability"
      label={data.label}
      icon={<Activity size={22} />}
      selected={selected}
    />
  );
}

export default memo(ObservabilityNodeComponent);
