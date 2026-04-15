import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { PocketKnife } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ToolsNodeData } from '../types/nodes';

type ToolsNode = Node<ToolsNodeData>;

function ToolsNodeComponent({ data, selected }: NodeProps<ToolsNode>) {
  return (
    <BasePeripheralNode
      nodeType="tools"
      label={data.label}
      icon={<PocketKnife size={22} />}
      selected={selected}
    />
  );
}

export default memo(ToolsNodeComponent);
