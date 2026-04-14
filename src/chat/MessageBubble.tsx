import { memo, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, ChevronDown, Wrench } from 'lucide-react';
import type { Message } from '../store/session-store';
import StreamingText from './StreamingText';
import { markdownComponents } from './markdown-components';

function formatTokenBadge(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

interface MessageBubbleProps {
  msg: Message;
  /** True only for the single message currently being streamed in. */
  isStreamingThis: boolean;
  /** True when this streaming message is currently receiving reasoning deltas. */
  isReasoningThis?: boolean;
  preferPlainText?: boolean;
}

const thinkingMarkdownComponents = {
  p: (props: any) => { const { node, ...rest } = props; return <p className="mb-1.5 last:mb-0 leading-snug text-purple-100/80" {...rest} />; },
  a: (props: any) => { const { node, ...rest } = props; return <a className="text-purple-300 hover:text-purple-200 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} />; },
  ul: (props: any) => { const { node, ...rest } = props; return <ul className="list-disc pl-3.5 mb-1.5 space-y-0.5" {...rest} />; },
  ol: (props: any) => { const { node, ...rest } = props; return <ol className="list-decimal pl-3.5 mb-1.5 space-y-0.5" {...rest} />; },
  li: (props: any) => { const { node, ...rest } = props; return <li className="marker:text-purple-400/60" {...rest} />; },
  h1: (props: any) => { const { node, ...rest } = props; return <h1 className="text-[11px] font-bold mt-2 mb-1 text-purple-100" {...rest} />; },
  h2: (props: any) => { const { node, ...rest } = props; return <h2 className="text-[11px] font-bold mt-2 mb-1 text-purple-100" {...rest} />; },
  h3: (props: any) => { const { node, ...rest } = props; return <h3 className="text-[10px] font-semibold mt-1.5 mb-0.5 text-purple-200 uppercase tracking-wide" {...rest} />; },
  strong: (props: any) => { const { node, ...rest } = props; return <strong className="font-semibold text-purple-50" {...rest} />; },
  em: (props: any) => { const { node, ...rest } = props; return <em className="italic text-purple-200/90" {...rest} />; },
  blockquote: (props: any) => { const { node, ...rest } = props; return <blockquote className="border-l-2 border-purple-400/40 pl-2 my-1.5 italic text-purple-200/70" {...rest} />; },
  hr: () => <hr className="my-2 border-purple-500/20" />,
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <pre className="rounded bg-slate-950/60 border border-purple-500/20 p-2 my-1.5 overflow-x-auto text-[10px] font-mono text-purple-100/90 leading-snug">
        <code className={className} {...rest}>{children}</code>
      </pre>
    ) : (
      <code className="bg-slate-950/60 px-1 py-px rounded border border-purple-500/20 text-purple-100/90 font-mono text-[10px]" {...rest}>
        {children}
      </code>
    );
  },
};

function MessageBubble({
  msg,
  isStreamingThis,
  isReasoningThis = false,
  preferPlainText = false,
}: MessageBubbleProps) {
  const isDiagnostic = msg.kind === 'diagnostic';
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const hasThinking =
    msg.role === 'assistant' && ((msg.thinking && msg.thinking.length > 0) || isReasoningThis);

  // While streaming, render a fade-in animation char-by-char and defer the
  // markdown swap until the reveal has caught up to the final content.
  const [revealComplete, setRevealComplete] = useState(!isStreamingThis);
  useEffect(() => {
    if (isStreamingThis) setRevealComplete(false);
  }, [isStreamingThis]);
  const handleRevealComplete = useCallback(() => setRevealComplete(true), []);
  const useStreamingRenderer = msg.role === 'assistant' && (isStreamingThis || !revealComplete);

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {hasThinking && (
          <div className="mb-1 rounded-md border border-purple-500/20 bg-purple-500/10">
            <button
              type="button"
              onClick={() => setThinkingExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
            >
              <Brain
                size={12}
                className={`text-purple-400 ${isReasoningThis ? 'animate-pulse' : ''}`}
              />
              <span className="flex-1 text-[10px] text-purple-300">
                {isReasoningThis ? 'Thinking...' : 'Thinking'}
              </span>
              <ChevronDown
                size={12}
                className={`text-purple-400 transition-transform ${thinkingExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {thinkingExpanded && (
              <div className="border-t border-purple-500/20 px-3 py-2 text-[10px] leading-relaxed">
                {msg.thinking ? (
                  // Skip markdown parsing while reasoning is still streaming —
                  // parse once when it settles. Collapsed-by-default means the
                  // parse doesn't happen at all until the user opens the panel.
                  isReasoningThis ? (
                    <pre className="whitespace-pre-wrap break-words font-sans text-purple-100/80">
                      {msg.thinking}
                    </pre>
                  ) : (
                    <div className="prose-sm max-w-none break-words text-purple-100/80">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={thinkingMarkdownComponents}>
                        {msg.thinking}
                      </ReactMarkdown>
                    </div>
                  )
                ) : (
                  <p className="italic text-purple-300/60">Waiting for reasoning…</p>
                )}
              </div>
            )}
          </div>
        )}
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
              {useStreamingRenderer ? (
                <StreamingText
                  text={msg.content}
                  isStreaming={isStreamingThis}
                  onRevealComplete={handleRevealComplete}
                />
              ) : preferPlainText ? (
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
