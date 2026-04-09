import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useRightAnchoredResize } from './useRightAnchoredResize';

function ResizeHarness({ onWidthChange = () => undefined }: { onWidthChange?: (width: number) => void }) {
  const [width, setWidth] = useState(420);
  const { width: resolvedWidth, onResizeStart } = useRightAnchoredResize({
    width,
    minWidth: 320,
    maxWidth: 700,
    onWidthChange: (nextWidth) => {
      setWidth(nextWidth);
      onWidthChange(nextWidth);
    },
  });

  return (
    <div>
      <div data-testid="panel" style={{ width: `${resolvedWidth}px` }} />
      <button type="button" onMouseDown={onResizeStart}>
        Resize
      </button>
    </div>
  );
}

describe('useRightAnchoredResize', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('resizes width from the right edge while dragging', () => {
    render(<ResizeHarness />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize' }), {
      clientX: 900,
    });
    fireEvent.mouseMove(document, { clientX: 760 });
    fireEvent.mouseUp(document);

    expect(screen.getByTestId('panel')).toHaveStyle({ width: '440px' });
  });

  it('clamps the resized width to the configured bounds', () => {
    render(<ResizeHarness />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize' }), {
      clientX: 900,
    });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);

    expect(screen.getByTestId('panel')).toHaveStyle({ width: '700px' });
  });

  it('updates the visible width while dragging but only commits once on mouseup', () => {
    const onWidthChange = vi.fn();
    render(<ResizeHarness onWidthChange={onWidthChange} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Resize' }), {
      clientX: 900,
    });
    fireEvent.mouseMove(document, { clientX: 760 });

    expect(screen.getByTestId('panel')).toHaveStyle({ width: '440px' });
    expect(onWidthChange).not.toHaveBeenCalled();

    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalledTimes(1);
    expect(onWidthChange).toHaveBeenCalledWith(440);
  });
});
