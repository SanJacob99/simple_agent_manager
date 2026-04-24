import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { stripStaleToolResultImages } from './context-engine';

function toolResult(
  text: string,
  withImage: boolean,
  id = text,
  savedPath?: string,
): AgentMessage {
  const image = savedPath !== undefined
    ? { type: 'image', mimeType: 'image/jpeg', data: 'fake-base64', savedPath }
    : { type: 'image', mimeType: 'image/jpeg', data: 'fake-base64' };
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: 'browser',
    content: withImage ? [{ type: 'text', text }, image] : [{ type: 'text', text }],
    isError: false,
    timestamp: 0,
  } as unknown as AgentMessage;
}

function userMsg(text: string, withImage = false): AgentMessage {
  return {
    role: 'user',
    content: withImage
      ? [
          { type: 'text', text },
          { type: 'image', mimeType: 'image/png', data: 'fake-base64' },
        ]
      : text,
    timestamp: 0,
  } as unknown as AgentMessage;
}

function countImages(msg: AgentMessage): number {
  const content = (msg as unknown as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  return content.filter(
    (block) =>
      block && typeof block === 'object' &&
      (block as { type?: unknown }).type === 'image',
  ).length;
}

describe('stripStaleToolResultImages', () => {
  it('keeps images in the N most recent tool results and strips older ones', () => {
    const messages: AgentMessage[] = [
      toolResult('oldest', true, 'r1'),
      toolResult('middle', true, 'r2'),
      toolResult('newest', true, 'r3'),
    ];

    const stripped = stripStaleToolResultImages(messages, 2);

    expect(countImages(stripped[0])).toBe(0); // oldest stripped
    expect(countImages(stripped[1])).toBe(1); // kept
    expect(countImages(stripped[2])).toBe(1); // kept

    const oldestText = (
      (stripped[0] as unknown as { content: Array<{ text?: string }> }).content[1]
    ).text;
    expect(oldestText).toMatch(/screenshot removed/i);
  });

  it('preserves non-toolResult messages and their images untouched', () => {
    const messages: AgentMessage[] = [
      userMsg('hello with pic', true),
      toolResult('old', true, 'r1'),
      toolResult('new', true, 'r2'),
    ];

    const stripped = stripStaleToolResultImages(messages, 1);

    expect(countImages(stripped[0])).toBe(1); // user image intact
    expect(countImages(stripped[1])).toBe(0); // old tool image stripped
    expect(countImages(stripped[2])).toBe(1); // newest tool image kept
  });

  it('does not mutate the input messages', () => {
    const original = toolResult('old', true, 'r1');
    const messages: AgentMessage[] = [original, toolResult('new', true, 'r2')];

    stripStaleToolResultImages(messages, 1);

    expect(countImages(original)).toBe(1);
    expect(
      (original as unknown as { content: Array<{ type: string }> }).content.length,
    ).toBe(2);
  });

  it('is a no-op when no tool results carry images', () => {
    const messages: AgentMessage[] = [
      userMsg('hi'),
      toolResult('plain', false, 'r1'),
      toolResult('also plain', false, 'r2'),
    ];

    const stripped = stripStaleToolResultImages(messages, 2);

    expect(stripped).toEqual(messages);
  });

  it('points the placeholder at savedPath so the agent can reach the file', () => {
    const messages: AgentMessage[] = [
      toolResult('old', true, 'r1', 'browser-screenshots/auto-123.jpg'),
      toolResult('new', true, 'r2'),
    ];

    const stripped = stripStaleToolResultImages(messages, 1);

    const replacement = (
      (stripped[0] as unknown as { content: Array<{ text?: string }> }).content[1]
    ).text;
    expect(replacement).toContain('browser-screenshots/auto-123.jpg');
    expect(replacement).toMatch(/reachable at/);
  });

  it('falls back to generic placeholder when savedPath is missing', () => {
    const messages: AgentMessage[] = [
      toolResult('old', true, 'r1'),
      toolResult('new', true, 'r2'),
    ];

    const stripped = stripStaleToolResultImages(messages, 1);

    const replacement = (
      (stripped[0] as unknown as { content: Array<{ text?: string }> }).content[1]
    ).text;
    expect(replacement).toMatch(/save tokens/);
  });

  it('strips everything when keepRecent is 0', () => {
    const messages: AgentMessage[] = [
      toolResult('one', true, 'r1'),
      toolResult('two', true, 'r2'),
    ];

    const stripped = stripStaleToolResultImages(messages, 0);

    expect(countImages(stripped[0])).toBe(0);
    expect(countImages(stripped[1])).toBe(0);
  });
});
