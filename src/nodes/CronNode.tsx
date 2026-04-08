import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Clock } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { CronNodeData } from '../types/nodes';

type CronNode = Node<CronNodeData>;

function CronNodeComponent({ data, selected }: NodeProps<CronNode>) {
  return (
    <BasePeripheralNode
      nodeType="cron"
      label={data.label}
      icon={<Clock size={14} />}
      selected={selected}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${data.enabled ? 'bg-green-400' : 'bg-slate-600'}`}
        />
        <span>{data.schedule || 'No schedule'}</span>
      </div>
      <div className="truncate text-slate-500">
        {data.sessionMode === 'ephemeral' ? 'Ephemeral' : 'Persistent'}
      </div>
    </BasePeripheralNode>
  );
}

export default memo(CronNodeComponent);
