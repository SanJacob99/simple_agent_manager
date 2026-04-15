import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import type { AgentNodeData } from '../types/nodes';
import { NODE_COLORS } from '../utils/theme';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import HexNode from './HexNode';

type AgentNode = Node<AgentNodeData>;

function AgentNodeComponent({ id, data, selected }: NodeProps<AgentNode>) {
  const color = NODE_COLORS.agent;
  const openChat = useAgentConnectionStore((s) => s.openChatDrawer);
  const chatAgentId = useAgentConnectionStore((s) => s.chatAgentNodeId);
  const isActive = chatAgentId === id;

  return (
    <HexNode
      color={color}
      selected={selected}
      handles={
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-slate-700"
          style={{ left: -6, backgroundColor: color }}
        />
      }
      cornerSlot={
        <button
          onClick={(e) => {
            e.stopPropagation();
            openChat(id);
          }}
          className="nodrag flex h-6 w-6 items-center justify-center rounded-full transition"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 24%, var(--c-slate-900))`,
            color,
            border: `1px solid color-mix(in srgb, ${color} 60%, transparent)`,
          }}
          title="Open Chat"
        >
          <MessageSquare size={11} />
        </button>
      }
    >
      <img src="/svg/favicon.svg" alt="" width={26} height={26} />
      <span
        className="text-[12px] font-bold text-slate-100"
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={data.name}
      >
        {data.name}
      </span>
      {isActive && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
      )}
    </HexNode>
  );
}

export default memo(AgentNodeComponent);
