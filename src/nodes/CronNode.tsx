import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { CalendarClock } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { CronNodeData } from '../types/nodes';

type CronNode = Node<CronNodeData>;

function CronNodeComponent({ data, selected }: NodeProps<CronNode>) {
  return (
    <BasePeripheralNode
      nodeType="cron"
      label={data.label}
      icon={<CalendarClock size={22} />}
      selected={selected}
    />
  );
}

export default memo(CronNodeComponent);
