import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../settings/settings-store';
import { markdownComponents } from './markdown-components';
import { autoClose, findSafeRevealCount } from './autoClose';
import type { Block } from './streaming-markdown-scanner';

interface StreamingBlockProps {
  block: Block;
}

function StreamingBlockImpl({ block }: StreamingBlockProps) {
  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const { textRevealEnabled, textRevealCharsPerSec } = chatUIDefaults;

  const [displayCount, setDisplayCount] = useState(() =>
    textRevealEnabled ? 0 : block.contentSource.length,
  );

  const contentRef = useRef(block.contentSource);
  const statusRef = useRef(block.status);
  const enabledRef = useRef(textRevealEnabled);
  const rateRef = useRef(textRevealCharsPerSec);
  contentRef.current = block.contentSource;
  statusRef.current = block.status;
  enabledRef.current = textRevealEnabled;
  rateRef.current = textRevealCharsPerSec;

  useEffect(() => {
    let raf: number | null = null;
    let lastTick: number | null = null;
    let revealed = enabledRef.current ? 0 : contentRef.current.length;

    const tick = (now: number) => {
      if (lastTick === null) lastTick = now;
      const dt = now - lastTick;
      lastTick = now;

      const content = contentRef.current;
      if (!enabledRef.current) {
        revealed = content.length;
        setDisplayCount(content.length);
      } else {
        const advance = (dt / 1000) * rateRef.current;
        const prev = Math.floor(revealed);
        revealed = Math.min(content.length, revealed + advance);
        const next = Math.floor(revealed);
        if (next !== prev) setDisplayCount(next);
      }

      if (statusRef.current === 'closed' && revealed >= contentRef.current.length) {
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  if (block.children && (block.type === 'list' || block.type === 'table')) {
    const slice = block.frameSource;
    return (
      <div className="stream-block-in">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {slice}
        </ReactMarkdown>
        {block.children.map((child) => (
          <StreamingBlock key={child.id} block={child} />
        ))}
      </div>
    );
  }

  const safeCount = findSafeRevealCount(block.contentSource, displayCount, block.type);
  const visibleContent = block.contentSource.slice(0, safeCount);
  const merged = block.frameSource + visibleContent;
  const closedInput = autoClose(merged, block.type);

  return (
    <div className="stream-block-in">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {closedInput}
      </ReactMarkdown>
    </div>
  );
}

const StreamingBlock = memo(StreamingBlockImpl, (prev, next) => {
  return (
    prev.block.id === next.block.id &&
    prev.block.status === next.block.status &&
    prev.block.contentSource.length === next.block.contentSource.length &&
    (prev.block.children?.length ?? 0) === (next.block.children?.length ?? 0)
  );
});

export default StreamingBlock;
