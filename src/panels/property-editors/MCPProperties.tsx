import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import { useAgentConnectionStore } from '../../store/agent-connection-store';
import type {
  MCPNodeData,
  McpConnectionStatus,
  McpTransport,
} from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: MCPNodeData;
}

const TRANSPORT_OPTIONS: Array<{ value: McpTransport; label: string; hint: string }> = [
  { value: 'stdio', label: 'Local (stdio)', hint: 'Spawns a subprocess and talks over stdin/stdout.' },
  { value: 'http', label: 'Remote (HTTP)', hint: 'JSON-RPC over HTTP. Set a URL and optional auth headers.' },
  { value: 'sse', label: 'Remote (SSE)', hint: 'Server-Sent Events stream. Set a URL and optional auth headers.' },
];

const STATUS_LABEL: Record<McpConnectionStatus, string> = {
  unknown: 'Not yet connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Error',
  disconnected: 'Disconnected',
};

const STATUS_DOT: Record<McpConnectionStatus, string> = {
  unknown: 'bg-slate-500',
  connecting: 'bg-amber-500 animate-pulse',
  connected: 'bg-emerald-500',
  error: 'bg-red-500',
  disconnected: 'bg-slate-500',
};

function isRemote(transport: McpTransport) {
  return transport === 'http' || transport === 'sse';
}

/** Shared "key: value" editor used for args, env, headers, and allowedTools. */
function KeyValueList({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const add = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...entries, [k]: newVal });
    setNewKey('');
    setNewVal('');
  };

  const remove = (k: string) => {
    const { [k]: _, ...rest } = entries;
    onChange(rest);
  };

  return (
    <div className="space-y-1">
      {Object.entries(entries).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1 text-xs">
          <span className="font-mono text-slate-400">{k}:</span>
          <span className="flex-1 truncate text-slate-300">{v}</span>
          <button onClick={() => remove(k)} className="text-red-400 hover:text-red-300">
            x
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          className={inputClass}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={keyPlaceholder}
        />
        <input
          className={inputClass}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder={valuePlaceholder}
        />
        <button
          onClick={add}
          className="shrink-0 rounded-md bg-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Token-list editor: args array, allowedTools array. */
function TokenList({
  tokens,
  onChange,
  placeholder,
}: {
  tokens: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...tokens, v]);
    setDraft('');
  };

  const remove = (i: number) => {
    onChange(tokens.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-1">
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tokens.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
            >
              {t}
              <button
                onClick={() => remove(i)}
                className="text-slate-500 hover:text-red-400"
                aria-label={`Remove ${t}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <button
          onClick={add}
          className="shrink-0 rounded-md bg-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function MCPProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const mcpState = useAgentConnectionStore((s) => s.mcps[nodeId]);
  const status: McpConnectionStatus = mcpState?.status ?? 'unknown';
  const remote = isRemote(data.transport);

  const hint = TRANSPORT_OPTIONS.find((o) => o.value === data.transport)?.hint;

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Connection">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          <span>{STATUS_LABEL[status]}</span>
          {mcpState?.error && (
            <span className="truncate text-[10px] text-red-400" title={mcpState.error}>
              — {mcpState.error}
            </span>
          )}
        </div>
      </Field>

      <Field label="Transport" tooltip={hint}>
        <select
          className={selectClass}
          value={data.transport}
          onChange={(e) =>
            update(nodeId, { transport: e.target.value as McpTransport })
          }
        >
          {TRANSPORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      {!remote && (
        <>
          <Field label="Command" tooltip="Executable to launch, e.g. `npx` or `python`.">
            <input
              className={inputClass}
              value={data.command}
              onChange={(e) => update(nodeId, { command: e.target.value })}
              placeholder="npx"
            />
          </Field>

          <Field label="Args" tooltip="Arguments passed to the command, one per token.">
            <TokenList
              tokens={data.args}
              onChange={(next) => update(nodeId, { args: next })}
              placeholder="arg"
            />
          </Field>

          <Field label="Working Directory" tooltip="Empty = inherit the server's cwd.">
            <input
              className={inputClass}
              value={data.cwd}
              onChange={(e) => update(nodeId, { cwd: e.target.value })}
              placeholder="(inherit)"
            />
          </Field>

          <Field label="Env" tooltip="Extra environment variables for the subprocess.">
            <KeyValueList
              entries={data.env}
              onChange={(next) => update(nodeId, { env: next })}
              keyPlaceholder="NAME"
              valuePlaceholder="value"
            />
          </Field>
        </>
      )}

      {remote && (
        <>
          <Field label="URL" tooltip="Full endpoint URL of the MCP server.">
            <input
              className={inputClass}
              value={data.url}
              onChange={(e) => update(nodeId, { url: e.target.value })}
              placeholder="https://mcp.example.com/rpc"
            />
          </Field>

          <Field label="Headers" tooltip="Sent with every request. Use for auth tokens.">
            <KeyValueList
              entries={data.headers}
              onChange={(next) => update(nodeId, { headers: next })}
              keyPlaceholder="Header"
              valuePlaceholder="value"
            />
          </Field>
        </>
      )}

      <Field
        label="Tool Prefix"
        tooltip="Prepended to every tool name from this server (e.g. `fs_`). Empty = no prefix."
      >
        <input
          className={inputClass}
          value={data.toolPrefix}
          onChange={(e) => update(nodeId, { toolPrefix: e.target.value })}
          placeholder="(none)"
        />
      </Field>

      <Field
        label="Allowed Tools"
        tooltip="Whitelist of tool names to expose. Empty = all tools from the server."
      >
        <TokenList
          tokens={data.allowedTools}
          onChange={(next) => update(nodeId, { allowedTools: next })}
          placeholder="tool_name"
        />
      </Field>

      <Field label="Auto-connect">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={data.autoConnect}
            onChange={(e) => update(nodeId, { autoConnect: e.target.checked })}
          />
          Connect when the agent starts
        </label>
      </Field>
    </div>
  );
}
