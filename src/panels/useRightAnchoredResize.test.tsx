import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { useRightAnchoredResize } from './useRightAnchoredResize';

function ResizeHarness() {
  const [width, setWidth] = useState(420);
  const { width: resolvedWidth, onResizeStart } = useRightAnchoredResize({
    width,
    minWidth: 320,
    maxWidth: 700,
    onWidthChange: setWidth,
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
});
