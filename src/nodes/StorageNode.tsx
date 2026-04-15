import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { HardDrive, Folder } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import HexHint from './HexHint';
import { NODE_COLORS } from '../utils/theme';
import type { StorageNodeData, StorageBackend } from '../types/nodes';

type StorageNode = Node<StorageNodeData>;

const BACKEND_LABEL: Record<StorageBackend, string> = {
  filesystem: 'Filesystem',
};

function renderBackendIcon(backend: StorageBackend) {
  switch (backend) {
    case 'filesystem':
      return <Folder size={9} strokeWidth={2.5} />;
  }
}

function StorageNodeComponent({ data, selected }: NodeProps<StorageNode>) {
  const color = NODE_COLORS.storage;

  const hints = (
    <HexHint
      color={color}
      title={`Backend: ${BACKEND_LABEL[data.backendType] ?? data.backendType}`}
    >
      {renderBackendIcon(data.backendType)}
    </HexHint>
  );

  return (
    <BasePeripheralNode
      nodeType="storage"
      label={data.label}
      icon={<HardDrive size={22} />}
      selected={selected}
      hints={hints}
    />
  );
}

export default memo(StorageNodeComponent);
