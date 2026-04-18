import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { PocketKnife } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import HexHint from './HexHint';
import { NODE_COLORS } from '../utils/theme';
import type { ToolsNodeData } from '../types/nodes';

type ToolsNode = Node<ToolsNodeData>;

const PROFILE_SHORT: Record<string, string> = {
  full: 'ALL',
  coding: 'DEV',
  messaging: 'MSG',
  minimal: 'MIN',
  custom: 'CUS',
};

const PROFILE_LABEL: Record<string, string> = {
  full: 'Full — all tool groups',
  coding: 'Coding — runtime, fs, coding, memory',
  messaging: 'Messaging — web, communication, memory',
  minimal: 'Minimal — web only',
  custom: 'Custom selection',
};

function ToolsNodeComponent({ data, selected }: NodeProps<ToolsNode>) {
  const color = NODE_COLORS.tools;
  const profile = data.profile || 'full';

  const hints = (
    <HexHint
      color={color}
      title={PROFILE_LABEL[profile] ?? profile}
    >
      {PROFILE_SHORT[profile] ?? profile.slice(0, 3).toUpperCase()}
    </HexHint>
  );

  return (
    <BasePeripheralNode
      nodeType="tools"
      label={data.label}
      icon={<PocketKnife size={22} />}
      selected={selected}
      hints={hints}
    />
  );
}

export default memo(ToolsNodeComponent);
