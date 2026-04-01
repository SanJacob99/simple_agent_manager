import { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_COLORS } from '../utils/theme';
import type { NodeType } from '../types/nodes';

interface BasePeripheralNodeProps {
  nodeType: NodeType;
  label: string;
  icon: ReactNode;
  children?: ReactNode;
  selected?: boolean;
}

function BasePeripheralNodeInner({
  nodeType,
  label,
  icon,
  children,
  selected,
}: BasePeripheralNodeProps) {
  const color = NODE_COLORS[nodeType];

  return (
    <div
      className="min-w-[160px] rounded-lg border bg-slate-900 shadow-lg transition-shadow"
      style={{
        borderColor: selected ? color : '#334155',
        boxShadow: selected ? `0 0 16px ${color}40` : undefined,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-2"
        style={{ backgroundColor: `${color}15` }}
      >
        <span style={{ color }}>{icon}</span>
        <span className="text-xs font-semibold text-slate-200">{label}</span>
      </div>

      {/* Content */}
      {children && (
        <div className="px-3 py-2 text-[11px] text-slate-400">{children}</div>
      )}

      {/* Source handle (connects to agent) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-slate-700 !bg-slate-400"
        style={{ right: -6 }}
      />
    </div>
  );
}

export default memo(BasePeripheralNodeInner);
