import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { MessageSquare, Brain } from 'lucide-react';
import type { AgentNodeData, ProviderNodeData, ThinkingLevel } from '../types/nodes';
import { NODE_COLORS } from '../utils/theme';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { useGraphStore } from '../store/graph-store';
import HexNode from './HexNode';
import HexHint from './HexHint';

type AgentNode = Node<AgentNodeData>;

interface BrandInfo {
  label: string;
  color: string;
  iconSrc?: string;
}

const PROVIDER_BRANDS: Record<string, BrandInfo> = {
  openrouter: {
    label: 'OR',
    color: '#f472b6',
    iconSrc: '/svg/openrouter.svg',
  },
  anthropic: { label: 'A', color: '#d97706' },
  openai: { label: 'O', color: '#10a37f' },
  google: { label: 'G', color: '#4285f4' },
  xai: { label: 'X', color: '#94a3b8' },
  mistral: { label: 'M', color: '#fb923c' },
  deepseek: { label: 'D', color: '#a855f7' },
};

const LLM_BRANDS: Record<string, BrandInfo> = {
  anthropic: { label: 'A', color: '#d97706' },
  openai: { label: 'O', color: '#10a37f' },
  google: { label: 'G', color: '#4285f4' },
  'x-ai': { label: 'X', color: '#94a3b8' },
  xai: { label: 'X', color: '#94a3b8' },
  meta: { label: 'M', color: '#1877f2' },
  'meta-llama': { label: 'M', color: '#1877f2' },
  mistralai: { label: 'M', color: '#fb923c' },
  mistral: { label: 'M', color: '#fb923c' },
  deepseek: { label: 'D', color: '#a855f7' },
  qwen: { label: 'Q', color: '#8b5cf6' },
};

const THINKING_COLORS: Record<ThinkingLevel, string | null> = {
  off: null,
  minimal: '#4ade80',
  low: '#a3e635',
  medium: '#facc15',
  high: '#fb923c',
  xhigh: '#f87171',
};

function resolveProviderBrand(pluginId: string): BrandInfo {
  const key = pluginId.toLowerCase();
  return (
    PROVIDER_BRANDS[key] ?? {
      label: pluginId.slice(0, 2).toUpperCase() || '?',
      color: 'var(--c-slate-400)',
    }
  );
}

function resolveLlmBrand(modelId: string): BrandInfo | null {
  if (!modelId) return null;
  const prefix = modelId.includes('/') ? modelId.split('/')[0] : modelId;
  const key = prefix.toLowerCase();
  return (
    LLM_BRANDS[key] ?? {
      label: prefix.charAt(0).toUpperCase() || '?',
      color: 'var(--c-slate-400)',
    }
  );
}

function AgentNodeComponent({ id, data, selected }: NodeProps<AgentNode>) {
  const color = NODE_COLORS.agent;
  const openChat = useAgentConnectionStore((s) => s.openChatDrawer);
  const chatAgentId = useAgentConnectionStore((s) => s.chatAgentNodeId);
  const isActive = chatAgentId === id;

  const providerPluginId = useGraphStore((s) => {
    for (const edge of s.edges) {
      if (edge.target !== id) continue;
      const src = s.nodes.find((n) => n.id === edge.source);
      if (src?.data.type === 'provider') {
        return (src.data as ProviderNodeData).pluginId ?? '';
      }
    }
    return null;
  });

  const llmBrand = resolveLlmBrand(data.modelId);
  const thinkingColor = THINKING_COLORS[data.thinkingLevel];

  const hints = (
    <>
      {providerPluginId !== null && (() => {
        const brand = resolveProviderBrand(providerPluginId);
        return (
          <HexHint
            color={brand.color}
            title={`Provider: ${providerPluginId || 'unset'}`}
          >
            {brand.iconSrc ? (
              <span
                style={{
                  display: 'block',
                  width: 11,
                  height: 11,
                  backgroundColor: brand.color,
                  WebkitMaskImage: `url(${brand.iconSrc})`,
                  maskImage: `url(${brand.iconSrc})`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                }}
              />
            ) : (
              brand.label
            )}
          </HexHint>
        );
      })()}
      {llmBrand && (
        <HexHint color={llmBrand.color} title={`Model: ${data.modelId}`}>
          {llmBrand.label}
        </HexHint>
      )}
      {thinkingColor && (
        <HexHint
          color={thinkingColor}
          title={`Thinking: ${data.thinkingLevel}`}
        >
          <Brain size={9} strokeWidth={2.5} />
        </HexHint>
      )}
    </>
  );

  return (
    <HexNode
      color={color}
      selected={selected}
      hints={hints}
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
