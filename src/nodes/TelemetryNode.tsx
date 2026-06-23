import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Activity } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { TelemetryNodeData } from '../types/nodes';

type TelemetryNode = Node<TelemetryNodeData>;

function TelemetryNodeComponent({ data, selected }: NodeProps<TelemetryNode>) {
  return (
    <BasePeripheralNode
      nodeType="telemetry"
      label={data.label}
      icon={<Activity size={22} />}
      selected={selected}
    />
  );
}

export default memo(TelemetryNodeComponent);
