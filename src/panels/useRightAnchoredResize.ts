import { useCallback, useEffect } from 'react';

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
  const clampedWidth = clampRightAnchoredPanelWidth(
    width,
    minWidth,
    maxWidth,
    viewportMargin,
  );

  useEffect(() => {
    if (clampedWidth !== width) {
      onWidthChange(clampedWidth);
    }
  }, [clampedWidth, onWidthChange, width]);

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        onWidthChange(
          clampRightAnchoredPanelWidth(
            window.innerWidth - moveEvent.clientX,
            minWidth,
            maxWidth,
            viewportMargin,
          ),
        );
      };

      const handleMouseUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [maxWidth, minWidth, onWidthChange, viewportMargin],
  );

  return {
    width: clampedWidth,
    onResizeStart,
  };
}
