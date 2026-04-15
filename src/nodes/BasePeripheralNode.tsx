import { memo, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_COLORS } from '../utils/theme';
import type { NodeType } from '../types/nodes';
import HexNode from './HexNode';

interface BasePeripheralNodeProps {
  nodeType: NodeType;
  label: string;
  icon: ReactNode;
  selected?: boolean;
}

function BasePeripheralNodeInner({
  nodeType,
  label,
  icon,
  selected,
}: BasePeripheralNodeProps) {
  const color = NODE_COLORS[nodeType];

  return (
    <HexNode
      color={color}
      selected={selected}
      handles={
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-slate-700 !bg-slate-400"
          style={{ right: -6 }}
        />
      }
    >
      <span style={{ color }}>{icon}</span>
      <span
        className="text-[11px] font-semibold text-slate-100"
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </span>
    </HexNode>
  );
}

export default memo(BasePeripheralNodeInner);
