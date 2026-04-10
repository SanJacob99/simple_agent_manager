import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContextUsagePanel from './ContextUsagePanel';

const contextInfo = {
  contextWindow: 1000,
  maxTokens: 200,
  source: 'default' as const,
};

describe('ContextUsagePanel', () => {
  it('does not warn when mounted through loading and resize-like rerenders', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender, unmount } = render(
      <ContextUsagePanel
        messages={[]}
        contextInfo={contextInfo}
        peripheralReservations={[]}
      />,
    );

    rerender(
      <div style={{ width: 480 }}>
        <ContextUsagePanel
          messages={[
            {
              id: 'm1',
              role: 'assistant',
              content: 'Used some context',
              timestamp: Date.now(),
              tokenCount: 250,
            },
          ]}
          contextInfo={contextInfo}
          peripheralReservations={[
            {
              label: 'System prompt',
              type: 'system-prompt',
              tokenEstimate: 100,
              isTodo: false,
            },
          ]}
        />
      </div>,
    );

    unmount();

    const chartWarnings = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((value) => String(value))
      .filter((message) => message.includes('The width(') || message.includes('The height('));

    expect(chartWarnings).toEqual([]);
  });
});
