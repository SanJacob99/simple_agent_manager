import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../settings/settings-store';

interface StreamingTextProps {
  text: string;
  /** Whether the source stream is still producing deltas. */
  isStreaming: boolean;
  /** Called once the reveal animation catches up to `text.length` after the stream ends. */
  onRevealComplete?: () => void;
}

const INITIAL_BUFFER_CHARS = 14;
const INITIAL_BUFFER_MS = 220;

export default function StreamingText({ text, isStreaming, onRevealComplete }: StreamingTextProps) {
  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const { textRevealEnabled, textRevealCharsPerSec, textRevealFadeMs } = chatUIDefaults;

  const [displayCount, setDisplayCount] = useState(() =>
    textRevealEnabled ? 0 : text.length,
  );

  const textRef = useRef(text);
  const isStreamingRef = useRef(isStreaming);
  const onRevealCompleteRef = useRef(onRevealComplete);
  const baseRateRef = useRef(textRevealCharsPerSec);
  const enabledRef = useRef(textRevealEnabled);
  textRef.current = text;
  isStreamingRef.current = isStreaming;
  onRevealCompleteRef.current = onRevealComplete;
  baseRateRef.current = textRevealCharsPerSec;
  enabledRef.current = textRevealEnabled;

  useEffect(() => {
    let rafId: number | null = null;
    let lastTick: number | null = null;
    let startTime: number | null = null;
    let bufferReady = false;
    let revealed = 0;
    let completed = false;

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      if (lastTick === null) lastTick = now;
      const dt = now - lastTick;
      lastTick = now;

      const currentText = textRef.current;
      const currentStreaming = isStreamingRef.current;
      const remaining = currentText.length - revealed;

      if (!enabledRef.current) {
        // Animation disabled — fast-forward to the head of the stream.
        if (remaining > 0) {
          revealed = currentText.length;
          setDisplayCount(currentText.length);
        }
      } else if (remaining > 0) {
        if (!bufferReady) {
          const elapsed = now - startTime;
          const enoughChars = remaining >= INITIAL_BUFFER_CHARS;
          const enoughTime = elapsed >= INITIAL_BUFFER_MS;
          if ((enoughChars && enoughTime) || !currentStreaming) {
            bufferReady = true;
          }
        }

        if (bufferReady) {
          // Strictly linear reveal: always advance at exactly the configured
          // base rate, whether the source stream is still producing or has
          // already ended. Any backlog that built up during fast streaming is
          // drained at the same pace, so the animation never bursts.
          const rate = baseRateRef.current;

          const advance = (dt / 1000) * rate;
          const prevFloor = Math.floor(revealed);
          revealed = Math.min(currentText.length, revealed + advance);
          const nextFloor = Math.floor(revealed);
          if (nextFloor !== prevFloor) {
            setDisplayCount(nextFloor);
          }
        }
      }

      if (!currentStreaming && revealed >= currentText.length) {
        if (!completed && currentText.length > 0) {
          completed = true;
          onRevealCompleteRef.current?.();
        }
        if (!completed && currentText.length === 0) {
          // nothing to reveal; still notify so parent can swap renderers
          completed = true;
          onRevealCompleteRef.current?.();
        }
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  if (!textRevealEnabled) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  const fadeStyle = { ['--stream-fade-ms' as string]: `${textRevealFadeMs}ms` } as React.CSSProperties;
  const visible = text.slice(0, displayCount);
  const chars: React.ReactNode[] = [];
  for (let i = 0; i < visible.length; i++) {
    chars.push(
      <span key={i} className="stream-char-fade">
        {visible[i]}
      </span>,
    );
  }

  return (
    <span className="whitespace-pre-wrap" style={fadeStyle}>
      {chars}
    </span>
  );
}
