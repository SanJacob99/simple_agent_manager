import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Wrench } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ToolsNodeData } from '../types/nodes';

type ToolsNode = Node<ToolsNodeData>;

function ToolsNodeComponent({ data, selected }: NodeProps<ToolsNode>) {
  return (
    <BasePeripheralNode
      nodeType="tools"
      label={data.label}
      icon={<Wrench size={14} />}
      selected={selected}
    >
      <div>{data.enabledTools.length} tools enabled</div>
      <div className="truncate">{data.enabledTools.join(', ')}</div>
    </BasePeripheralNode>
  );
}

export default memo(ToolsNodeComponent);
