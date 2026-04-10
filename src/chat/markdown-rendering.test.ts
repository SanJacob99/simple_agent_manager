import { describe, expect, it } from 'vitest';
import { getInitialRichMarkdownMessageIds } from './markdown-rendering';
import type { Message } from '../store/session-store';

function makeMessage(id: string, role: Message['role']): Message {
  return {
    id,
    role,
    content: `${role}-${id}`,
    timestamp: Date.now(),
  };
}

describe('getInitialRichMarkdownMessageIds', () => {
  it('returns only the most recent assistant messages for eager markdown rendering', () => {
    const messages: Message[] = [
      makeMessage('u1', 'user'),
      makeMessage('a1', 'assistant'),
      makeMessage('a2', 'assistant'),
      makeMessage('t1', 'tool'),
      makeMessage('a3', 'assistant'),
      makeMessage('a4', 'assistant'),
    ];

    expect(getInitialRichMarkdownMessageIds(messages, 2)).toEqual(['a3', 'a4']);
  });

  it('returns all assistant messages when there are fewer than the eager limit', () => {
    const messages: Message[] = [
      makeMessage('u1', 'user'),
      makeMessage('a1', 'assistant'),
      makeMessage('a2', 'assistant'),
    ];

    expect(getInitialRichMarkdownMessageIds(messages, 6)).toEqual(['a1', 'a2']);
  });
});
