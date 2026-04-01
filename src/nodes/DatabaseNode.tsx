import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Database } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { DatabaseNodeData } from '../types/nodes';

type DatabaseNode = Node<DatabaseNodeData>;

function DatabaseNodeComponent({ data, selected }: NodeProps<DatabaseNode>) {
  return (
    <BasePeripheralNode
      nodeType="database"
      label={data.label}
      icon={<Database size={14} />}
      selected={selected}
    >
      <div>Type: {data.dbType}</div>
      <div className="truncate">
        {data.connectionString || 'Not configured'}
      </div>
    </BasePeripheralNode>
  );
}

export default memo(DatabaseNodeComponent);
