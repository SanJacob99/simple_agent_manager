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
        contextInfo={contextInfo}
        usage={undefined}
      />,
    );

    rerender(
      <div style={{ width: 480 }}>
        <ContextUsagePanel
          contextInfo={contextInfo}
          usage={{
            sessionKey: 'test',
            at: Date.now(),
            contextTokens: 250,
            contextWindow: 1000,
            usage: {
              input: 200,
              output: 50,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 250,
            },
            source: 'actual',
          }}
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
