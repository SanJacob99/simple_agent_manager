import { useState } from 'react';
import { useGraphStore } from '../store/graph-store';
import { useSamAgentStore } from '../store/sam-agent-store';
import { samAgentClient } from '../client/sam-agent-client';
import type { WorkflowPatch, WorkflowPatchResult } from '../../shared/sam-agent/workflow-patch';

interface Props {
  messageId: string;
  toolCallId: string;
  resultJson: string;
  patchState: 'pending' | 'applied' | 'discarded' | 'failed';
}

export function SamAgentApplyCard({ messageId, toolCallId, resultJson, patchState }: Props) {
  const [expanded, setExpanded] = useState(false);
  const applyPatch = useGraphStore((s) => s.applyPatch);
  const setPatchState = useSamAgentStore((s) => s.setPatchState);

  let parsed: WorkflowPatchResult;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">malformed patch</div>;
  }

  if (!parsed.ok) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        Patch invalid: {parsed.errors.map((e) => e.message).join('; ')}
      </div>
    );
  }

  const patch: WorkflowPatch = parsed.patch;
  const summary = patch.rationale || `${patch.add_nodes.length} adds, ${patch.update_nodes.length} edits, ${patch.remove_nodes.length} deletes`;

  const handleApply = () => {
    const result = applyPatch(patch);
    if (result.ok) {
      setPatchState(messageId, toolCallId, 'applied');
      samAgentClient.patchState(messageId, toolCallId, 'applied');
    } else {
      setPatchState(messageId, toolCallId, 'failed');
      samAgentClient.patchState(messageId, toolCallId, 'failed');
    }
  };

  const handleDiscard = () => {
    setPatchState(messageId, toolCallId, 'discarded');
    samAgentClient.patchState(messageId, toolCallId, 'discarded');
  };

  const stateBadge =
    patchState === 'applied' ? <span className="text-emerald-600">Applied</span>
    : patchState === 'discarded' ? <span className="text-stone-400">Discarded</span>
    : patchState === 'failed' ? <span className="text-rose-600">Failed</span>
    : null;

  return (
    <div className="my-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setExpanded((e) => !e)} className="flex-1 text-left text-xs text-stone-700">
          {summary}
        </button>
        {stateBadge}
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-stone-100 pt-2 text-[11px] font-mono text-stone-600">
          {patch.add_nodes.map((n) => (
            <div key={n.tempId}>+ {n.type} {(n.data as Record<string, unknown>)['name'] ? `"${(n.data as Record<string, unknown>)['name']}"` : ''}</div>
          ))}
          {patch.update_nodes.map((u) => (
            <div key={u.id}>~ {u.id}: {Object.keys(u.dataPatch).join(', ')}</div>
          ))}
          {patch.remove_nodes.map((id) => (
            <div key={id}>- {id}</div>
          ))}
          {patch.add_edges.map((e, i) => (
            <div key={i}>+ edge {e.source} → {e.target}</div>
          ))}
          {patch.remove_edges.map((id) => (
            <div key={id}>- edge {id}</div>
          ))}
        </div>
      )}
      {patchState === 'pending' && (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={handleApply} className="rounded-md bg-stone-800 px-3 py-1 text-xs text-white hover:bg-stone-700">Apply</button>
          <button onClick={handleDiscard} className="rounded-md bg-stone-100 px-3 py-1 text-xs text-stone-700 hover:bg-stone-200">Discard</button>
        </div>
      )}
    </div>
  );
}
