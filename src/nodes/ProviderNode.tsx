import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Cpu } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ProviderNodeData } from '../types/nodes';

type ProviderNode = Node<ProviderNodeData>;

function ProviderNodeComponent({ data, selected }: NodeProps<ProviderNode>) {
  return (
    <BasePeripheralNode
      nodeType="provider"
      label={data.label}
      icon={<Cpu size={14} />}
      selected={selected}
    >
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
          {data.pluginId || 'none'}
        </span>
        {data.baseUrl && (
          <span
            className="truncate text-[10px] text-slate-500"
            title={data.baseUrl}
          >
            {data.baseUrl}
          </span>
        )}
      </div>
    </BasePeripheralNode>
  );
}

export default memo(ProviderNodeComponent);
