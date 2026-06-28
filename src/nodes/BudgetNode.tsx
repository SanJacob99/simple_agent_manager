import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Wallet } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { BudgetNodeData } from '../types/nodes';

type BudgetNode = Node<BudgetNodeData>;

function BudgetNodeComponent({ data, selected }: NodeProps<BudgetNode>) {
  return (
    <BasePeripheralNode
      nodeType="budget"
      label={data.label}
      icon={<Wallet size={22} />}
      selected={selected}
    />
  );
}

export default memo(BudgetNodeComponent);
