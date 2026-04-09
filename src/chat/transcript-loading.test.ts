import { describe, expect, it } from 'vitest';
import { shouldShowTranscriptLoading } from './transcript-loading';

describe('shouldShowTranscriptLoading', () => {
  it('shows the loading screen while hydrating an empty active session', () => {
    expect(shouldShowTranscriptLoading({
      isBlocked: false,
      storageReady: true,
      activeTranscriptStatus: 'loading',
      activeSessionKey: 'agent:one:main',
      messageCount: 0,
    })).toBe(true);
  });

  it('keeps existing messages visible while a completed turn is flushing to storage', () => {
    expect(shouldShowTranscriptLoading({
      isBlocked: false,
      storageReady: true,
      activeTranscriptStatus: 'loading',
      activeSessionKey: 'agent:one:main',
      messageCount: 2,
    })).toBe(false);
  });
});
