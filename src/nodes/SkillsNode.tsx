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
      icon={<Sparkles size={14} />}
      selected={selected}
    >
      <div>{data.enabledSkills.length} skills</div>
      <div className="truncate">{data.enabledSkills.join(', ')}</div>
    </BasePeripheralNode>
  );
}

export default memo(SkillsNodeComponent);
