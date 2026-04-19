import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AlertTriangle, Brain, ChevronDown, Trash2, Wrench } from 'lucide-react';
import type { Message, MessageAudio } from '../store/session-store';
import StreamingText from './StreamingText';
import StreamingMarkdownRenderer from './StreamingMarkdownRenderer';
import { markdownComponents } from './markdown-components';
import { useSettingsStore } from '../settings/settings-store';
import {
  isPcmMimeType,
  pcmParamsForProvider,
  wrapPcmAsWav,
} from '../../shared/audio-format';

function formatTokenBadge(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Renders a single inline audio clip from a tool result. Raw PCM
 * payloads (mime `audio/L16` etc.) are wrapped in a WAV header on the
 * fly for retrocompat with old transcripts that predate the server-side
 * wrap; everything else is played as-is via a Blob URL.
 */
function AudioAttachment({ audio, label }: { audio: MessageAudio; label: string }) {
  const blobUrl = useMemo(() => {
    try {
      const binary = atob(audio.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      let payload: Uint8Array = bytes;
      let mime = audio.mimeType;
      if (isPcmMimeType(mime)) {
        payload = wrapPcmAsWav(bytes, pcmParamsForProvider(audio.provider));
        mime = 'audio/wav';
      }

      const blob = new Blob([payload], { type: mime });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [audio.data, audio.mimeType, audio.provider]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (!blobUrl) {
    return (
      <div className="text-[10px] text-amber-400 font-mono">
        {label}: failed to decode audio payload
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <audio controls preload="auto" className="w-full" src={blobUrl}>
        Your browser does not support inline audio playback.
      </audio>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400 font-mono">
        {audio.filename && <span>{audio.filename}</span>}
        {audio.provider && <span className="text-slate-500">via {audio.provider}</span>}
        <a
          href={blobUrl}
          download={audio.filename ?? 'audio-clip'}
          className="text-blue-400 hover:text-blue-300 underline"
        >
          download
        </a>
      </div>
      {audio.transcript && (
        <div className="text-[10px] leading-snug text-slate-400 italic">
          "{audio.transcript.length > 160
            ? audio.transcript.slice(0, 160).trimEnd() + '…'
            : audio.transcript}"
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  msg: Message;
  /** True only for the single message currently being streamed in. */
  isStreamingThis: boolean;
  /** True when this streaming message is currently receiving reasoning deltas. */
  isReasoningThis?: boolean;
  preferPlainText?: boolean;
  onDelete?: (messageId: string) => void;
}

const thinkingMarkdownComponents = {
  p: (props: any) => { const { node, ...rest } = props; return <p className="mb-1.5 last:mb-0 leading-snug text-slate-200" {...rest} />; },
  a: (props: any) => { const { node, ...rest } = props; return <a className="text-blue-300 hover:text-blue-200 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} />; },
  ul: (props: any) => { const { node, ...rest } = props; return <ul className="list-disc pl-3.5 mb-1.5 space-y-0.5" {...rest} />; },
  ol: (props: any) => { const { node, ...rest } = props; return <ol className="list-decimal pl-3.5 mb-1.5 space-y-0.5" {...rest} />; },
  li: (props: any) => { const { node, ...rest } = props; return <li className="marker:text-purple-400" {...rest} />; },
  h1: (props: any) => { const { node, ...rest } = props; return <h1 className="text-[11px] font-bold mt-2 mb-1 text-slate-100" {...rest} />; },
  h2: (props: any) => { const { node, ...rest } = props; return <h2 className="text-[11px] font-bold mt-2 mb-1 text-slate-100" {...rest} />; },
  h3: (props: any) => { const { node, ...rest } = props; return <h3 className="text-[10px] font-semibold mt-1.5 mb-0.5 text-slate-200 uppercase tracking-wide" {...rest} />; },
  strong: (props: any) => { const { node, ...rest } = props; return <strong className="font-semibold text-slate-50" {...rest} />; },
  em: (props: any) => { const { node, ...rest } = props; return <em className="italic text-slate-300" {...rest} />; },
  blockquote: (props: any) => { const { node, ...rest } = props; return <blockquote className="border-l-2 border-purple-400/40 pl-2 my-1.5 italic text-slate-300" {...rest} />; },
  hr: () => <hr className="my-2 border-purple-500/20" />,
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <pre className="rounded bg-slate-950/60 border border-purple-500/20 p-2 my-1.5 overflow-x-auto text-[10px] font-mono text-slate-200 leading-snug">
        <code className={className} {...rest}>{children}</code>
      </pre>
    ) : (
      <code className="bg-slate-950/60 px-1 py-px rounded border border-purple-500/20 text-slate-200 font-mono text-[10px]" {...rest}>
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
  onDelete,
}: MessageBubbleProps) {
  const isDiagnostic = msg.kind === 'diagnostic';
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [toolExpanded, setToolExpanded] = useState(false);
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
  const textRevealStructure = useSettingsStore((s) => s.chatUIDefaults.textRevealStructure);

  // Tool results render as a collapsible section (like thinking), not a chat bubble
  if (msg.role === 'tool') {
    const toolLabel = msg.toolName ?? 'tool';
    const isWaiting = !msg.content;
    const borderColor = msg.isToolError ? 'border-red-500/20' : 'border-slate-600/30';
    const bgColor = msg.isToolError ? 'bg-red-500/10' : 'bg-slate-800/40';
    const iconColor = msg.isToolError ? 'text-red-400' : 'text-slate-400';
    return (
      <div className="group/msg flex justify-start">
        <div className="max-w-[85%] w-full relative">
          <div className={`rounded-md border ${borderColor} ${bgColor}`}>
            <button
              type="button"
              onClick={() => setToolExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
            >
              {msg.isToolError ? (
                <AlertTriangle size={12} className={iconColor} />
              ) : (
                <Wrench
                  size={12}
                  className={`${iconColor} ${isWaiting ? 'animate-pulse' : ''}`}
                />
              )}
              <span className="flex-1 text-[10px] text-slate-300 font-mono">
                {isWaiting ? `${toolLabel}…` : toolLabel}
              </span>
              {msg.tokenCount != null && msg.tokenCount > 0 && (
                <span className="text-[8px] tabular-nums text-slate-500 font-mono">
                  {formatTokenBadge(msg.tokenCount)}
                </span>
              )}
              <ChevronDown
                size={12}
                className={`text-slate-500 transition-transform ${toolExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {msg.images && msg.images.length > 0 && (
              <div className={`border-t ${borderColor} px-3 py-2 flex flex-wrap gap-2`}>
                {msg.images.map((img, i) => (
                  <img
                    key={i}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={`${msg.toolName ?? 'tool'} output ${i + 1}`}
                    className="max-w-full max-h-96 rounded border border-slate-700/50 object-contain"
                  />
                ))}
              </div>
            )}
            {msg.audios && msg.audios.length > 0 && (
              <div className={`border-t ${borderColor} px-3 py-2 flex flex-col gap-2`}>
                {msg.audios.map((audio, i) => (
                  <AudioAttachment
                    key={i}
                    audio={audio}
                    label={`${msg.toolName ?? 'tool'} output ${i + 1}`}
                  />
                ))}
              </div>
            )}
            {toolExpanded && msg.content && (
              <div className={`border-t ${borderColor} px-3 py-2 text-[10px] leading-relaxed`}>
                <pre className="whitespace-pre-wrap break-words font-mono text-slate-300 max-h-60 overflow-y-auto">
                  {msg.content}
                </pre>
              </div>
            )}
          </div>
          {onDelete && !isStreamingThis && (
            <button
              type="button"
              onClick={() => onDelete(msg.id)}
              className="absolute -right-1 -top-1 rounded p-0.5 bg-slate-800 border border-slate-700 text-slate-500 opacity-0 transition group-hover/msg:opacity-100 hover:text-red-400 hover:border-red-500/30"
              title="Delete message"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`group/msg flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] relative">
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
              <span className="flex-1 text-[10px] text-slate-300">
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
                  isReasoningThis ? (
                    <pre className="whitespace-pre-wrap break-words font-sans text-slate-200">
                      {msg.thinking}
                    </pre>
                  ) : (
                    <div className="prose-sm max-w-none break-words text-slate-200">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={thinkingMarkdownComponents}
                      >
                        {msg.thinking}
                      </ReactMarkdown>
                    </div>
                  )
                ) : (
                  <p className="italic text-slate-400">Waiting for reasoning…</p>
                )}
              </div>
            )}
          </div>
        )}
        <div
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            msg.role === 'user'
              ? 'bg-blue-600 text-white'
              : isDiagnostic
                ? 'border border-amber-500/30 bg-amber-500/10 text-slate-100'
                : 'bg-slate-800 text-slate-100'
          }`}
        >
          {msg.role === 'assistant' ? (
            <div className={`prose-sm max-w-none break-words text-slate-100`}>
              {useStreamingRenderer ? (
                textRevealStructure === 'blocks' ? (
                  <StreamingMarkdownRenderer
                    text={msg.content}
                    isStreaming={isStreamingThis}
                    onRevealComplete={handleRevealComplete}
                  />
                ) : (
                  <StreamingText
                    text={msg.content}
                    isStreaming={isStreamingThis}
                    onRevealComplete={handleRevealComplete}
                  />
                )
              ) : preferPlainText ? (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
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
        {onDelete && !isStreamingThis && (
          <button
            type="button"
            onClick={() => onDelete(msg.id)}
            className={`absolute -top-1 rounded p-0.5 bg-slate-800 border border-slate-700 text-slate-500 opacity-0 transition group-hover/msg:opacity-100 hover:text-red-400 hover:border-red-500/30 ${
              msg.role === 'user' ? '-left-1' : '-right-1'
            }`}
            title="Delete message"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
