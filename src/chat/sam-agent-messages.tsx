import type { SamAgentMessage } from '../../shared/sam-agent/protocol-types';
import { SamAgentApplyCard } from './sam-agent-apply-card';

interface Props {
  messages: SamAgentMessage[];
  streaming: { messageId: string; text: string; toolResults?: SamAgentMessage['toolResults'] } | null;
}

export function SamAgentMessages({ messages, streaming }: Props) {
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="text-xs text-stone-400">No conversation yet.</p>
        <p className="mt-1 text-[11px] text-stone-400">Ask about a node type, or describe a workflow you want to build.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id}>
          <div className={m.role === 'user' ? 'rounded-2xl bg-stone-100 px-3 py-2 text-sm text-stone-800' : 'text-sm text-stone-800 whitespace-pre-wrap'}>
            {m.text}
          </div>
          {m.toolResults?.map((tr) => {
            if (tr.toolName === 'propose_workflow_patch') {
              return (
                <SamAgentApplyCard
                  key={tr.toolCallId}
                  messageId={m.id}
                  toolCallId={tr.toolCallId}
                  resultJson={tr.resultJson}
                  patchState={tr.patchState ?? 'pending'}
                />
              );
            }
            return (
              <div key={tr.toolCallId} className="my-1 text-[11px] text-stone-400">{tr.toolName}</div>
            );
          })}
        </div>
      ))}
      {streaming && (
        <div className="text-sm text-stone-800 whitespace-pre-wrap">{streaming.text}</div>
      )}
    </div>
  );
}
