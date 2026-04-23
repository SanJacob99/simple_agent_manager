import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Server, Globe } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import HexHint from './HexHint';
import { NODE_COLORS } from '../utils/theme';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import type {
  MCPNodeData,
  McpConnectionStatus,
  McpTransport,
} from '../types/nodes';

type MCPNode = Node<MCPNodeData>;

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: 'Local subprocess (stdio)',
  http: 'Remote HTTP endpoint',
  sse: 'Remote SSE stream',
};

const STATUS_LABEL: Record<McpConnectionStatus, string> = {
  unknown: 'Not yet connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

// Status dot color. Uses CSS vars where available, raw hex otherwise.
const STATUS_COLOR: Record<McpConnectionStatus, string> = {
  unknown: 'var(--c-slate-500)',
  connecting: 'var(--c-amber-500)',
  connected: 'var(--c-emerald-500)',
  error: 'var(--c-red-500)',
  disconnected: 'var(--c-slate-500)',
};

function isRemote(transport: McpTransport) {
  return transport === 'http' || transport === 'sse';
}

function transportIcon(transport: McpTransport) {
  if (isRemote(transport)) return <Globe size={22} />;
  return <Server size={22} />;
}

function endpointSummary(data: MCPNodeData): string {
  if (isRemote(data.transport)) {
    return data.url ? data.url : '(no URL set)';
  }
  const cmd = data.command || '(no command set)';
  return data.args.length > 0 ? `${cmd} ${data.args.join(' ')}` : cmd;
}

function StatusDot({ status }: { status: McpConnectionStatus }) {
  return (
    <span
      aria-label={STATUS_LABEL[status]}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: STATUS_COLOR[status],
        boxShadow:
          status === 'connected'
            ? `0 0 4px ${STATUS_COLOR.connected}`
            : undefined,
        animation: status === 'connecting' ? 'streamCharFade 1.4s ease-in-out infinite' : undefined,
      }}
    />
  );
}

function MCPNodeComponent({ id, data, selected }: NodeProps<MCPNode>) {
  const color = NODE_COLORS.mcp;
  const transport = data.transport;

  // Reading this selector on each render keeps the node reactive to
  // `mcp:status` events from the server.
  const state = useAgentConnectionStore((s) => s.mcps[id]);
  const status: McpConnectionStatus = state?.status ?? 'unknown';
  const error = state?.error;

  const tooltip = [
    `Transport: ${TRANSPORT_LABEL[transport]}`,
    `Endpoint: ${endpointSummary(data)}`,
    `Status: ${STATUS_LABEL[status]}${error ? ` — ${error}` : ''}`,
  ].join('\n');

  // Two hints side by side: transport (L/R) and live status dot.
  const hints = (
    <>
      <HexHint color={color} title={TRANSPORT_LABEL[transport]}>
        {isRemote(transport) ? 'R' : 'L'}
      </HexHint>
      <HexHint
        color={STATUS_COLOR[status]}
        title={`${STATUS_LABEL[status]}${error ? ` — ${error}` : ''}`}
      >
        <StatusDot status={status} />
      </HexHint>
    </>
  );

  return (
    <BasePeripheralNode
      nodeType="mcp"
      label={data.label}
      icon={
        <span title={tooltip} style={{ display: 'inline-flex' }}>
          {transportIcon(transport)}
        </span>
      }
      selected={selected}
      hints={hints}
    />
  );
}

export default memo(MCPNodeComponent);
