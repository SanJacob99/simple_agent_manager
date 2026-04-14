import { useEffect, useRef, useState } from 'react';
import StreamingBlock from './StreamingBlock';
import { createScanner, type Block, type Scanner } from './streaming-markdown-scanner';
import { useSettingsStore } from '../settings/settings-store';

interface StreamingMarkdownRendererProps {
  /** Current full content of the streaming message. */
  text: string;
  /** True while the source stream is still producing deltas. */
  isStreaming: boolean;
  /** Called once every block's reveal cursor has caught up after the stream ends. */
  onRevealComplete?: () => void;
}

export default function StreamingMarkdownRenderer({
  text,
  isStreaming,
  onRevealComplete,
}: StreamingMarkdownRendererProps) {
  const scannerRef = useRef<Scanner | null>(null);
  const consumedRef = useRef(0);
  const [blocks, setBlocks] = useState<readonly Block[]>([]);
  const completedRef = useRef(false);

  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const { textRevealCharsPerSec, textRevealEnabled } = chatUIDefaults;

  // Lazy scanner instantiation + subscription.
  if (scannerRef.current === null) {
    scannerRef.current = createScanner();
    scannerRef.current.onChange(() => {
      setBlocks(scannerRef.current!.getBlocks().slice());
    });
  }

  // Feed new chars to the scanner as `text` grows.
  useEffect(() => {
    const scanner = scannerRef.current!;
    if (text.length > consumedRef.current) {
      const chunk = text.slice(consumedRef.current);
      consumedRef.current = text.length;
      scanner.append(chunk);
    }
  }, [text]);

  // On stream end: finalize the scanner, let cursors drain, then fire reveal-complete.
  useEffect(() => {
    if (isStreaming) return;
    const scanner = scannerRef.current!;
    scanner.finalize();

    const unseenChars = blocks.reduce((sum, b) => {
      const contentLen = b.contentSource.length;
      return sum + contentLen + (b.children?.reduce((a, c) => a + c.contentSource.length, 0) ?? 0);
    }, 0);

    const drainMs = textRevealEnabled
      ? Math.max(200, (unseenChars / Math.max(1, textRevealCharsPerSec)) * 1000)
      : 200;

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onRevealComplete?.();
      }
    }, drainMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  return (
    <div className="stream-markdown-root">
      {blocks.map((block) => (
        <StreamingBlock key={block.id} block={block} />
      ))}
    </div>
  );
}
