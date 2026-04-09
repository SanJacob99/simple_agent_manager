import { describe, expect, it } from 'vitest';
import { getChatConnectionIssue } from './chat-connection-state';

describe('getChatConnectionIssue', () => {
  it('returns null when the websocket is connected', () => {
    expect(getChatConnectionIssue('connected', false)).toBeNull();
    expect(getChatConnectionIssue('connected', true)).toBeNull();
  });

  it('treats the first connection attempt as connecting, not disconnected', () => {
    expect(getChatConnectionIssue('connecting', false)).toMatchObject({
      key: 'connecting',
      label: 'Connecting to Backend',
    });

    expect(getChatConnectionIssue('disconnected', false)).toMatchObject({
      key: 'connecting',
      label: 'Connecting to Backend',
    });
  });

  it('shows a reconnecting state after a previously healthy connection begins reconnecting', () => {
    expect(getChatConnectionIssue('connecting', true)).toMatchObject({
      key: 'reconnecting',
      label: 'Reconnecting to Backend',
    });
  });

  it('shows a lost-connection state only after the app has connected before', () => {
    expect(getChatConnectionIssue('disconnected', true)).toMatchObject({
      key: 'disconnected',
      label: 'Connection Lost',
    });
  });
});
