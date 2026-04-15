import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { AgentCommNodeData } from '../types/nodes';

type AgentCommNode = Node<AgentCommNodeData>;

function AgentCommNodeComponent({ data, selected }: NodeProps<AgentCommNode>) {
  return (
    <BasePeripheralNode
      nodeType="agentComm"
      label={data.label}
      icon={<MessageSquare size={22} />}
      selected={selected}
    />
  );
}

export default memo(AgentCommNodeComponent);
