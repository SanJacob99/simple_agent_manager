import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Cloud } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import HexHint from './HexHint';
import type { ProviderNodeData } from '../types/nodes';

type ProviderNode = Node<ProviderNodeData>;

interface ProviderBrand {
  label: string;
  color: string;
  iconSrc?: string;
}

const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  openrouter: {
    label: 'OR',
    color: '#f472b6',
    iconSrc: '/svg/openrouter.svg',
  },
};

function resolveProviderBrand(pluginId: string): ProviderBrand {
  const key = pluginId.toLowerCase();
  return (
    PROVIDER_BRANDS[key] ?? {
      label: pluginId.slice(0, 2).toUpperCase() || '?',
      color: 'var(--c-slate-400)',
    }
  );
}

function ProviderNodeComponent({ data, selected }: NodeProps<ProviderNode>) {
  const brand = resolveProviderBrand(data.pluginId ?? '');

  const hints = (
    <HexHint
      color={brand.color}
      title={`Provider: ${data.pluginId || 'unset'}`}
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

  return (
    <BasePeripheralNode
      nodeType="provider"
      label={data.label}
      icon={<Cloud size={22} />}
      selected={selected}
      hints={hints}
    />
  );
}

export default memo(ProviderNodeComponent);
