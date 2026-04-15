import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { SkillsNodeData } from '../types/nodes';

type SkillsNode = Node<SkillsNodeData>;

function SkillsNodeComponent({ data, selected }: NodeProps<SkillsNode>) {
  return (
    <BasePeripheralNode
      nodeType="skills"
      label={data.label}
      icon={<Sparkles size={22} />}
      selected={selected}
    />
  );
}

export default memo(SkillsNodeComponent);
