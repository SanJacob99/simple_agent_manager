import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot, MessageSquare } from 'lucide-react';
import type { AgentNodeData } from '../types/nodes';
import { NODE_COLORS } from '../utils/theme';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useGraphStore } from '../store/graph-store';

type AgentNode = Node<AgentNodeData>;

function AgentNodeComponent({ id, data, selected }: NodeProps<AgentNode>) {
  const color = NODE_COLORS.agent;
  const openChat = useAgentConnectionStore((s) => s.openChatDrawer);
  const chatAgentId = useAgentConnectionStore((s) => s.chatAgentNodeId);
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const isActive = chatAgentId === id;
  const providerLabel = useMemo(() => {
    const incomingEdges = edges.filter((edge) => edge.target === id);
    for (const edge of incomingEdges) {
      const source = nodes.find((node) => node.id === edge.source);
      if (source?.data.type === 'provider') {
        return source.data.pluginId || 'no provider';
      }
    }
    return 'no provider';
  }, [edges, id, nodes]);

  return (
    <div
      className="min-w-[220px] rounded-xl border-2 bg-slate-900 shadow-xl transition-shadow"
      style={{
        borderColor: selected ? color : '#334155',
        boxShadow: selected ? `0 0 20px ${color}50` : `0 4px 16px #00000040`,
      }}
    >
      {/* Target handle (receives connections from peripherals) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-slate-700 !bg-blue-400"
        style={{ left: -6 }}
      />

      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-[10px] px-4 py-2.5"
        style={{ backgroundColor: `${color}20` }}
      >
        <Bot size={18} style={{ color }} />
        <span className="flex-1 text-sm font-bold text-slate-100">
          {data.name}
        </span>
        {isActive && (
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openChat(id);
          }}
          className="nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition"
          style={{
            backgroundColor: `${color}30`,
            color: color,
          }}
          title="Open Chat"
        >
          <MessageSquare size={10} />
          Chat
        </button>
      </div>

      {/* Body */}
      <div className="space-y-1.5 px-4 py-3">
        {/* Provider & Model */}
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            {providerLabel}
          </span>
          <span className="truncate text-[11px] text-slate-300">
            {data.modelId}
          </span>
        </div>

        {/* System Prompt Preview */}
        <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-500">
          {data.systemPrompt}
        </p>

        {/* Thinking Level */}
        {data.thinkingLevel !== 'off' && (
          <span className="inline-block rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400">
            thinking: {data.thinkingLevel}
          </span>
        )}

        {/* Tags */}
        {data.tags && data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(AgentNodeComponent);
