import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { ScrollText } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import HexHint from './HexHint';
import { NODE_COLORS } from '../utils/theme';
import type { ContextEngineNodeData, CompactionStrategy } from '../types/nodes';
import { useContextEngineSync } from './useContextEngineSync';

type ContextEngineNode = Node<ContextEngineNodeData>;

const STRATEGY_ABBREV: Record<CompactionStrategy, string> = {
  summary: 'SU',
  'sliding-window': 'SL',
  'trim-oldest': 'TR',
};

type BudgetTier = 'XS' | 'S' | 'M' | 'L' | 'XL';

function budgetTier(n: number): BudgetTier {
  if (!Number.isFinite(n) || n < 16_000) return 'XS';
  if (n < 65_000) return 'S';
  if (n < 256_000) return 'M';
  if (n < 1_000_000) return 'L';
  return 'XL';
}

const TIER_DESCRIPTION: Record<BudgetTier, string> = {
  XS: 'XS — up to 16k tokens',
  S: 'S — up to 64k tokens',
  M: 'M — up to 256k tokens',
  L: 'L — up to 1M tokens',
  XL: 'XL — 1M+ tokens',
};

function ContextEngineNodeComponent({ id, data, selected }: NodeProps<ContextEngineNode>) {
  // Sync context window capabilities down to the node data continuously while the node is mounted
  useContextEngineSync(id, data);

  const color = NODE_COLORS.contextEngine;
  const tier = budgetTier(data.tokenBudget);

  const hints = (
    <>
      <HexHint
        color={color}
        title={`Compaction strategy: ${data.compactionStrategy}`}
      >
        {STRATEGY_ABBREV[data.compactionStrategy] ??
          data.compactionStrategy.slice(0, 2).toUpperCase()}
      </HexHint>
      <HexHint
        color={color}
        title={`Context size: ${TIER_DESCRIPTION[tier]} (budget ${data.tokenBudget.toLocaleString()})`}
      >
        {tier}
      </HexHint>
    </>
  );

  return (
    <BasePeripheralNode
      nodeType="contextEngine"
      label={data.label}
      icon={<ScrollText size={22} />}
      selected={selected}
      hints={hints}
    />
  );
}

export default memo(ContextEngineNodeComponent);
