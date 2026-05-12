import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Brain, ChevronDown, Wrench } from 'lucide-react';
import type { SamAgentMessage } from '../../shared/sam-agent/protocol-types';
import { SamAgentApplyCard } from './sam-agent-apply-card';

interface Props {
  messages: SamAgentMessage[];
  streaming: {
    messageId: string;
    text: string;
    thinking?: string;
    isThinking?: boolean;
    toolResults?: SamAgentMessage['toolResults'];
  } | null;
}

const markdownComponents = {
  p: (props: any) => { const { node, ...rest } = props; return <p className="mb-1.5 last:mb-0 leading-snug" {...rest} />; },
  a: (props: any) => { const { node, ...rest } = props; return <a className="text-blue-600 hover:text-blue-500 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} />; },
  ul: (props: any) => { const { node, ...rest } = props; return <ul className="list-disc pl-4 mb-1.5 space-y-0.5" {...rest} />; },
  ol: (props: any) => { const { node, ...rest } = props; return <ol className="list-decimal pl-4 mb-1.5 space-y-0.5" {...rest} />; },
  li: (props: any) => { const { node, ...rest } = props; return <li className="marker:text-stone-400" {...rest} />; },
  h1: (props: any) => { const { node, ...rest } = props; return <h1 className="text-sm font-bold mt-2 mb-1 text-stone-900" {...rest} />; },
  h2: (props: any) => { const { node, ...rest } = props; return <h2 className="text-sm font-bold mt-2 mb-1 text-stone-900" {...rest} />; },
  h3: (props: any) => { const { node, ...rest } = props; return <h3 className="text-xs font-semibold mt-1.5 mb-0.5 text-stone-800 uppercase tracking-wide" {...rest} />; },
  strong: (props: any) => { const { node, ...rest } = props; return <strong className="font-semibold text-stone-900" {...rest} />; },
  em: (props: any) => { const { node, ...rest } = props; return <em className="italic" {...rest} />; },
  blockquote: (props: any) => { const { node, ...rest } = props; return <blockquote className="border-l-2 border-stone-300 pl-2 my-1.5 italic text-stone-600" {...rest} />; },
  hr: () => <hr className="my-2 border-stone-200" />,
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <pre className="rounded bg-stone-100 border border-stone-200 p-2 my-1.5 overflow-x-auto text-[11px] font-mono text-stone-800 leading-snug">
        <code className={className} {...rest}>{children}</code>
      </pre>
    ) : (
      <code className="bg-stone-100 px-1 py-px rounded border border-stone-200 text-stone-800 font-mono text-[11px]" {...rest}>
        {children}
      </code>
    );
  },
};

function ThinkingBlock({ thinking, isThinking }: { thinking: string; isThinking: boolean }) {
  // Expand by default while reasoning is actively streaming in — that's the
  // "show thinking output" affordance. Collapse after it settles.
  const [expanded, setExpanded] = useState(isThinking);
  return (
    <div className="mb-1 rounded-md border border-purple-200 bg-purple-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
      >
        <Brain
          size={11}
          className={`text-purple-500 ${isThinking ? 'animate-pulse' : ''}`}
        />
        <span className="flex-1 text-[10px] text-purple-700">
          {isThinking ? 'Thinking…' : 'Thinking'}
        </span>
        <ChevronDown
          size={11}
          className={`text-purple-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-purple-200 px-2.5 py-1.5 text-[11px] leading-relaxed text-stone-700">
          {thinking ? (
            <pre className="whitespace-pre-wrap break-words font-sans">{thinking}</pre>
          ) : (
            <p className="italic text-stone-400">Waiting for reasoning…</p>
          )}
        </div>
      )}
    </div>
  );
}

function ToolResultRow({
  toolName,
  resultJson,
  toolCallId,
  patchState,
  messageId,
}: {
  toolName: string;
  resultJson: string;
  toolCallId: string;
  patchState?: NonNullable<SamAgentMessage['toolResults']>[number]['patchState'];
  messageId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (toolName === 'propose_workflow_patch') {
    return (
      <SamAgentApplyCard
        messageId={messageId}
        toolCallId={toolCallId}
        resultJson={resultJson}
        patchState={patchState ?? 'pending'}
      />
    );
  }
  return (
    <div className="my-1 rounded-md border border-stone-200 bg-stone-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
      >
        <Wrench size={11} className="text-stone-500" />
        <span className="flex-1 text-[10px] text-stone-600 font-mono truncate">
          {toolName || 'tool'}
        </span>
        <ChevronDown
          size={11}
          className={`text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-stone-200 px-2.5 py-1.5 text-[10px]">
          <pre className="whitespace-pre-wrap break-words font-mono text-stone-600 max-h-60 overflow-y-auto">
            {resultJson || '(no result)'}
          </pre>
        </div>
      )}
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="prose-sm max-w-none break-words text-sm text-stone-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
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
          {m.role === 'user' ? (
            <div className="rounded-2xl bg-stone-100 px-3 py-2 text-sm text-stone-800 whitespace-pre-wrap">
              {m.text}
            </div>
          ) : (
            <>
              {m.thinking && (
                <ThinkingBlock thinking={m.thinking} isThinking={false} />
              )}
              <AssistantText text={m.text} />
            </>
          )}
          {m.toolResults?.map((tr) => (
            <ToolResultRow
              key={tr.toolCallId}
              messageId={m.id}
              toolCallId={tr.toolCallId}
              toolName={tr.toolName}
              resultJson={tr.resultJson}
              patchState={tr.patchState}
            />
          ))}
        </div>
      ))}
      {streaming && (
        <div>
          {(streaming.thinking || streaming.isThinking) && (
            <ThinkingBlock
              thinking={streaming.thinking ?? ''}
              isThinking={Boolean(streaming.isThinking)}
            />
          )}
          <AssistantText text={streaming.text} />
          {!streaming.text && !streaming.thinking && (
            <span className="inline-block h-3 w-1 animate-pulse bg-stone-400" />
          )}
          {streaming.toolResults?.map((tr) => (
            <ToolResultRow
              key={tr.toolCallId}
              messageId={streaming.messageId}
              toolCallId={tr.toolCallId}
              toolName={tr.toolName}
              resultJson={tr.resultJson}
              patchState={tr.patchState}
            />
          ))}
        </div>
      )}
    </div>
  );
}
