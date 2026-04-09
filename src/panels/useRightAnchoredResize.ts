import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_VIEWPORT_MARGIN = 160;

interface UseRightAnchoredResizeOptions {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  viewportMargin?: number;
}

export function clampRightAnchoredPanelWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
  viewportMargin = DEFAULT_VIEWPORT_MARGIN,
): number {
  const viewportBound =
    typeof window === 'undefined'
      ? maxWidth
      : Math.max(minWidth, Math.min(maxWidth, window.innerWidth - viewportMargin));

  return Math.min(viewportBound, Math.max(minWidth, Math.round(width)));
}

export function useRightAnchoredResize({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  viewportMargin = DEFAULT_VIEWPORT_MARGIN,
}: UseRightAnchoredResizeOptions) {
  const resolvedWidth = clampRightAnchoredPanelWidth(width, minWidth, maxWidth, viewportMargin);
  const [draftWidth, setDraftWidth] = useState(resolvedWidth);
  const draftWidthRef = useRef(resolvedWidth);
  const committedWidthRef = useRef(resolvedWidth);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    draftWidthRef.current = draftWidth;
  }, [draftWidth]);

  useEffect(() => {
    committedWidthRef.current = resolvedWidth;
    if (!isDraggingRef.current) {
      setDraftWidth(resolvedWidth);
    }
  }, [resolvedWidth]);

  useEffect(() => {
    if (resolvedWidth !== width) {
      onWidthChange(resolvedWidth);
    }
  }, [onWidthChange, resolvedWidth, width]);

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isDraggingRef.current = true;
      setDraftWidth(committedWidthRef.current);

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampRightAnchoredPanelWidth(
          window.innerWidth - moveEvent.clientX,
          minWidth,
          maxWidth,
          viewportMargin,
        );

        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setDraftWidth(nextWidth);
        });
      };

      const handleMouseUp = () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        isDraggingRef.current = false;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        const finalWidth = draftWidthRef.current;
        if (finalWidth !== committedWidthRef.current) {
          committedWidthRef.current = finalWidth;
          onWidthChange(finalWidth);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [maxWidth, minWidth, onWidthChange, viewportMargin],
  );

  return {
    width: draftWidth,
    onResizeStart,
  };
}
