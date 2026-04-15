import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { HardDrive } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { StorageNodeData } from '../types/nodes';

type StorageNode = Node<StorageNodeData>;

function StorageNodeComponent({ data, selected }: NodeProps<StorageNode>) {
  return (
    <BasePeripheralNode
      nodeType="storage"
      label={data.label}
      icon={<HardDrive size={22} />}
      selected={selected}
    />
  );
}

export default memo(StorageNodeComponent);
