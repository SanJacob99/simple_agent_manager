import { memo, useCallback, useEffect, useState } from 'react';
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

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) return s;
    s += String.fromCharCode(b);
  }
  return s;
}

const WAV_FORMAT_CODES: Record<number, string> = {
  0x0001: 'PCM',
  0x0003: 'IEEE_FLOAT',
  0x0006: 'ALAW',
  0x0007: 'MULAW',
  0x0055: 'MPEGLAYER3',
  0xfffe: 'EXTENSIBLE',
};

/**
 * Sanity-check the bytes we're handing to `<audio>`. For WAV, walks the
 * RIFF chunk list and surfaces the fmt fields (format code, channels,
 * sample rate, bits per sample, data chunk length) so diagnostic output
 * can pinpoint why the browser rejects a structurally-valid-looking
 * header. For non-WAV, just reports the first few bytes.
 */
function inspectAudioHeader(bytes: Uint8Array): string {
  if (bytes.length < 12) return `too short (${bytes.length} bytes)`;

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const riffSize = dv.getUint32(4, true);
    const parts: string[] = [
      `WAV total ${bytes.length}B`,
      `riff-size ${riffSize}B (expected ${bytes.length - 8})`,
    ];

    let offset = 12;
    let sawFmt = false;
    let sawData = false;
    // Walk chunks until we've seen fmt + data or we hit the end.
    while (offset + 8 <= bytes.length) {
      const tag = ascii(bytes, offset, 4);
      const size = dv.getUint32(offset + 4, true);
      if (tag === 'fmt ' && offset + 8 + Math.min(size, 16) <= bytes.length) {
        sawFmt = true;
        const code = dv.getUint16(offset + 8, true);
        const channels = dv.getUint16(offset + 10, true);
        const sampleRate = dv.getUint32(offset + 12, true);
        const byteRate = dv.getUint32(offset + 16, true);
        const blockAlign = dv.getUint16(offset + 20, true);
        const bitsPerSample = dv.getUint16(offset + 22, true);
        const codeName = WAV_FORMAT_CODES[code] ?? `UNKNOWN(0x${code.toString(16)})`;
        parts.push(
          `fmt{code=${code}/${codeName} ch=${channels} rate=${sampleRate} ` +
          `bps=${bitsPerSample} blockAlign=${blockAlign} byteRate=${byteRate}}`,
        );
      } else if (tag === 'data') {
        sawData = true;
        const actualRemaining = bytes.length - (offset + 8);
        parts.push(
          `data{declared=${size}B actual=${actualRemaining}B ` +
          `${size === actualRemaining ? 'match' : 'MISMATCH'}}`,
        );
        // Sniff the first bytes of the data payload. If the "PCM" is
        // actually some other container (mp3/opus/wav) that we're
        // wrapping in a WAV header by mistake, its signature will show
        // up here.
        const dataStart = offset + 8;
        if (dataStart + 16 <= bytes.length) {
          const first16 = Array.from(bytes.subarray(dataStart, dataStart + 16))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ');
          const asAscii = ascii(bytes, dataStart, 4);
          let signature = 'looks like raw PCM';
          if (asAscii === 'RIFF') signature = 'WAV header (double-wrapped!)';
          else if (asAscii === 'OggS') signature = 'OGG container';
          else if (asAscii === 'fLaC') signature = 'FLAC container';
          else if (bytes[dataStart] === 0xff && (bytes[dataStart + 1] & 0xe0) === 0xe0) {
            signature = 'MP3 frame sync (payload is mp3, not PCM)';
          } else if (bytes[dataStart] === 0x1a && bytes[dataStart + 1] === 0x45 &&
                     bytes[dataStart + 2] === 0xdf && bytes[dataStart + 3] === 0xa3) {
            signature = 'Matroska/WebM (opus/vorbis inside)';
          }
          parts.push(`payload-first16={${first16}} → ${signature}`);
        }
        break; // data is last; stop walking.
      } else {
        parts.push(`chunk{${tag} ${size}B}`);
      }
      offset += 8 + size + (size % 2); // chunks pad to even byte boundary
    }
    if (!sawFmt) parts.push('NO fmt chunk');
    if (!sawData) parts.push('NO data chunk');
    return parts.join(' | ');
  }

  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return `mp3 frame sync present (${bytes.length} bytes)`;
  }
  const first = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `unknown header (first 8 bytes: ${first}, total ${bytes.length} bytes)`;
}

interface PreparedAudio {
  blobUrl: string;
  wrappedAsWav: boolean;
  mime: string;
  byteLength: number;
  headerInfo: string;
}

/**
 * Renders a single inline audio clip from a tool result.
 *
 * Uses a Blob URL (not a `data:` URL). Raw PCM (mime `audio/L16` etc.)
 * gets wrapped in a WAV header on the fly for retrocompat with old
 * transcripts that predate the server-side wrap.
 *
 * The blob URL is created *inside* the effect — not via `useMemo` — so
 * it plays nicely with React strict mode. Strict mode mounts → runs
 * effects → runs cleanup → re-mounts; with `useMemo` + a cleanup
 * `useEffect`, the first cleanup revokes a URL the `useMemo` might
 * still be caching, and the audio element ends up with a dead
 * reference. Creating and revoking inside the same effect keeps each
 * pass self-contained.
 */
function AudioAttachment({ audio, label }: { audio: MessageAudio; label: string }) {
  const [prepared, setPrepared] = useState<PreparedAudio | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    let currentUrl: string | null = null;
    try {
      const binary = atob(audio.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      let payload: Uint8Array = bytes;
      let mime = audio.mimeType;
      let wrappedAsWav = false;
      if (isPcmMimeType(mime)) {
        payload = wrapPcmAsWav(bytes, pcmParamsForProvider(audio.provider));
        mime = 'audio/wav';
        wrappedAsWav = true;
      }

      const blob = new Blob([payload], { type: mime });
      currentUrl = URL.createObjectURL(blob);
      setPrepared({
        blobUrl: currentUrl,
        wrappedAsWav,
        mime,
        byteLength: payload.length,
        headerInfo: inspectAudioHeader(payload),
      });
      setPlaybackError(null);
    } catch {
      setPrepared(null);
    }
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [audio.data, audio.mimeType, audio.provider]);

  if (!prepared) {
    return (
      <div className="text-[10px] text-amber-400 font-mono">
        {label}: failed to decode audio payload
      </div>
    );
  }

  const durationIsUsable =
    duration !== null && Number.isFinite(duration) && duration > 0;
  const showDiagnostics = playbackError !== null || (duration !== null && !durationIsUsable);

  return (
    <div className="flex flex-col gap-1">
      <audio
        controls
        preload="auto"
        className="w-full"
        src={prepared.blobUrl}
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLAudioElement).duration;
          setDuration(d);
          setPlaybackError(null);
        }}
        onError={(e) => {
          const err = (e.target as HTMLAudioElement).error;
          const codes: Record<number, string> = {
            1: 'MEDIA_ERR_ABORTED',
            2: 'MEDIA_ERR_NETWORK',
            3: 'MEDIA_ERR_DECODE',
            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
          };
          setPlaybackError(
            err ? `${codes[err.code] ?? `code ${err.code}`}: ${err.message || '(no message)'}` : 'unknown error',
          );
        }}
      >
        Your browser does not support inline audio playback.
      </audio>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400 font-mono">
        {audio.filename && <span>{audio.filename}</span>}
        {audio.provider && <span className="text-slate-500">via {audio.provider}</span>}
        <button
          type="button"
          onClick={() => {
            // Create a fresh blob on click so the link never races with
            // React strict-mode's effect cleanup revoking the URL.
            try {
              const binary = atob(audio.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: audio.mimeType || 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = audio.filename ?? 'audio-clip';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            } catch (err) {
              console.error('download failed', err);
            }
          }}
          className="text-blue-400 hover:text-blue-300 underline cursor-pointer bg-transparent border-0 p-0"
        >
          download raw
        </button>
      </div>
      {showDiagnostics && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[9px] font-mono text-amber-200/90 leading-snug">
          <div>audio failed to decode — diagnostics:</div>
          {playbackError && <div>• error: {playbackError}</div>}
          {duration !== null && (
            <div>• reported duration: {String(duration)}</div>
          )}
          <div>• mime sent to blob: {prepared.mime}</div>
          <div>• wrapped as WAV on client: {prepared.wrappedAsWav ? 'yes' : 'no'}</div>
          <div>• original mime in details: {audio.mimeType}</div>
          <div>• header: {prepared.headerInfo}</div>
          <div className="text-amber-100/70">
            tip: click <em>download</em> above and open the file in an external player (VLC,
            ffplay) to verify whether the bytes are valid.
          </div>
        </div>
      )}
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
