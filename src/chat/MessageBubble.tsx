import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Wrench } from 'lucide-react';
import type { Message } from '../store/session-store';

function formatTokenBadge(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

interface MessageBubbleProps {
  msg: Message;
  /** True only for the single message currently being streamed in. */
  isStreamingThis: boolean;
  preferPlainText?: boolean;
}

const markdownComponents = {
  p: (props: any) => { const { node, ...rest } = props; return <p className="mb-2 last:mb-0 leading-relaxed" {...rest} />; },
  a: (props: any) => { const { node, ...rest } = props; return <a className="text-blue-400 hover:text-blue-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} />; },
  ul: (props: any) => { const { node, ...rest } = props; return <ul className="list-disc pl-4 mb-2 space-y-1" {...rest} />; },
  ol: (props: any) => { const { node, ...rest } = props; return <ol className="list-decimal pl-4 mb-2 space-y-1" {...rest} />; },
  li: (props: any) => { const { node, ...rest } = props; return <li className="marker:text-slate-500" {...rest} />; },
  h1: (props: any) => { const { node, ...rest } = props; return <h1 className="text-lg font-bold mt-4 mb-2 text-slate-100" {...rest} />; },
  h2: (props: any) => { const { node, ...rest } = props; return <h2 className="text-base font-bold mt-4 mb-2 text-slate-100 border-b border-slate-700/50 pb-1" {...rest} />; },
  h3: (props: any) => { const { node, ...rest } = props; return <h3 className="text-sm font-bold mt-3 mb-1 text-slate-200" {...rest} />; },
  table: (props: any) => { const { node, ...rest } = props; return <div className="overflow-x-auto my-3"><table className="w-full text-left border-collapse" {...rest} /></div>; },
  th: (props: any) => { const { node, ...rest } = props; return <th className="border border-slate-700 bg-slate-900/50 px-3 py-2 font-semibold text-slate-100" {...rest} />; },
  td: (props: any) => { const { node, ...rest } = props; return <td className="border border-slate-700 px-3 py-2 text-slate-300" {...rest} />; },
  blockquote: (props: any) => { const { node, ...rest } = props; return <blockquote className="border-l-4 border-blue-500/50 bg-slate-900/30 pl-3 py-1 pr-2 my-2 italic text-slate-400 rounded-r" {...rest} />; },
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <div className="rounded-md bg-[#0d1117] border border-slate-700/60 my-3 overflow-hidden shadow-sm">
        <div className="bg-slate-800/80 px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
          {match[1]}
        </div>
        <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 leading-normal">
          <code className={className} {...rest}>{children}</code>
        </pre>
      </div>
    ) : (
      <code className="bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/50 text-slate-300 font-mono text-[11px]" {...rest}>
        {children}
      </code>
    );
  },
};

function MessageBubble({ msg, isStreamingThis, preferPlainText = false }: MessageBubbleProps) {
  const isDiagnostic = msg.kind === 'diagnostic';

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        <div
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            msg.role === 'user'
              ? 'bg-blue-600 text-white'
              : msg.role === 'tool'
                ? 'border border-slate-700 bg-slate-800/50 text-slate-400 italic'
                : isDiagnostic
                  ? 'border border-amber-500/30 bg-amber-500/10 text-amber-50'
                  : 'bg-slate-800 text-slate-200'
          }`}
        >
          {msg.role === 'assistant' ? (
            <div className={`prose-sm max-w-none break-words ${isDiagnostic ? 'text-amber-50' : 'text-slate-200'}`}>
              {/* Skip ReactMarkdown while streaming — parse once when done */}
              {isStreamingThis || preferPlainText ? (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {msg.content}
                </ReactMarkdown>
              )}
              {!msg.content && isStreamingThis && (
                <span className="inline-block h-3 w-1 animate-pulse bg-slate-400" />
              )}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
          )}
        </div>

        {msg.tokenCount != null && msg.tokenCount > 0 && (
          <div className={`flex items-center gap-1 mt-0.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'tool' && <Wrench size={8} className="text-slate-600" />}
            <span className="text-[8px] tabular-nums text-slate-600 font-mono">
              {formatTokenBadge(msg.tokenCount)} tokens
            </span>
            {msg.usage && (
              <span className="text-[8px] text-slate-600 font-mono">
                (in:{formatTokenBadge(msg.usage.input)} out:{formatTokenBadge(msg.usage.output)})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
