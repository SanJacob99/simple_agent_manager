import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Plug } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { ConnectorsNodeData } from '../types/nodes';

type ConnectorsNode = Node<ConnectorsNodeData>;

function ConnectorsNodeComponent({ data, selected }: NodeProps<ConnectorsNode>) {
  return (
    <BasePeripheralNode
      nodeType="connectors"
      label={data.label}
      icon={<Plug size={14} />}
      selected={selected}
    >
      <div>Type: {data.connectorType}</div>
      <div>{Object.keys(data.config).length} config keys</div>
    </BasePeripheralNode>
  );
}

export default memo(ConnectorsNodeComponent);
