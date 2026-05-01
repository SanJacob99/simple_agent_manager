import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot } from 'lucide-react';
import HexNode from './HexNode';
import HexHint from './HexHint';
import { NODE_COLORS } from '../utils/theme';
import type { SubAgentNodeData } from '../types/nodes';
import { SUB_AGENT_NAME_REGEX } from '../../shared/sub-agent-types';

type SubAgentNode = Node<SubAgentNodeData>;

function SubAgentNodeComponent({ data, selected }: NodeProps<SubAgentNode>) {
  const color = NODE_COLORS.subAgent;
  const trimmedName = data.name?.trim() ?? '';
  const labelText = trimmedName || 'Sub-Agent';
  const validName = trimmedName ? SUB_AGENT_NAME_REGEX.test(trimmedName) : false;

  const hint = !trimmedName
    ? { tag: '!', tip: 'Sub-agent has no name yet — set one in the property panel.' }
    : !validName
    ? {
        tag: 'X',
        tip: 'Name must match /^[a-z][a-z0-9_-]{0,31}$/ (lowercase, digits, hyphen, underscore).',
      }
    : data.modelIdMode === 'inherit'
    ? { tag: 'INH', tip: 'Inherits modelId from the parent agent.' }
    : { tag: 'CUS', tip: 'Uses custom modelId override.' };

  return (
    <HexNode
      color={color}
      selected={selected}
      hints={
        <HexHint color={color} title={hint.tip}>
          {hint.tag}
        </HexHint>
      }
      handles={
        <>
          {/* Target on the left so dedicated peripherals (Tools / Provider /
              Skills / MCP) can connect into this sub-agent. */}
          <Handle
            type="target"
            position={Position.Left}
            className="!h-3 !w-3 !border-2 !border-slate-700"
            style={{ left: -6, backgroundColor: color }}
          />
          {/* Source on the right so the sub-agent can attach to its parent
              Agent node (peripheral → agent edge). */}
          <Handle
            type="source"
            position={Position.Right}
            className="!h-3 !w-3 !border-2 !border-slate-700 !bg-slate-400"
            style={{ right: -6 }}
          />
        </>
      }
    >
      <span style={{ color }}>
        <Bot size={22} />
      </span>
      <span
        className="text-[11px] font-semibold text-slate-100"
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={labelText}
      >
        {labelText}
      </span>
    </HexNode>
  );
}

export default memo(SubAgentNodeComponent);
