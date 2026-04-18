import { describe, expect, it } from 'vitest';
import {
  sanitizeAssistantVisibleText,
  sanitizeAssistantContentBlocks,
  stripThoughtChannelPreamble,
  stripUndelimitedThought,
} from './assistant-visible-text';

describe('stripThoughtChannelPreamble', () => {
  it('strips the Gemini preview thought preamble', () => {
    const input =
      '쓸᯼>thought\nCRITICAL INSTRUCTION 1: blah\nWait, let me think\nI will do X\nHello! How can I help?';
    const out = stripThoughtChannelPreamble(input);
    expect(out).toBe('Hello! How can I help?');
    expect(out).not.toContain('CRITICAL INSTRUCTION');
    expect(out).not.toContain('쓸᯼');
  });

  it('returns text unchanged when no preamble present', () => {
    const input = 'Just a normal answer.';
    expect(stripThoughtChannelPreamble(input)).toBe(input);
  });

  it('strips preamble with only the marker and no instruction lines', () => {
    const input = 'X>thought\nActual answer here';
    const out = stripThoughtChannelPreamble(input);
    expect(out).toBe('Actual answer here');
  });
});

describe('sanitizeAssistantVisibleText', () => {
  it('strips <|assistant|> harmony tokens', () => {
    const out = sanitizeAssistantVisibleText('<|assistant|>Hello world');
    expect(out).toBe('Hello world');
  });

  it('strips <thinking> tags and content', () => {
    const out = sanitizeAssistantVisibleText('<thinking>internal</thinking>Answer');
    expect(out).toBe('Answer');
  });

  it('strips Gemini thought preamble', () => {
    const input =
      '쓸᯼>thought\nCRITICAL INSTRUCTION 1: stuff\nLet me think about this\nHere is your answer.';
    const out = sanitizeAssistantVisibleText(input);
    expect(out).toBe('Here is your answer.');
  });

  it('handles combined leaks', () => {
    const input = '<|start|><thinking>hmm</thinking>Result<|end|>';
    const out = sanitizeAssistantVisibleText(input);
    expect(out).toBe('Result');
  });

  it('passes clean text through unchanged', () => {
    const input = 'Hello, how can I help you today?';
    expect(sanitizeAssistantVisibleText(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(sanitizeAssistantVisibleText('')).toBe('');
  });
});

describe('stripUndelimitedThought', () => {
  it('strips instruction-recap thought block', () => {
    const input =
      'ALWAYS START your thought with recalling critical instructions 1 and 2.\n' +
      'We need to save the results.\n' +
      'Tool to use: write_file.\n' +
      'Here is the answer.';
    expect(stripUndelimitedThought(input)).toBe('Here is the answer.');
  });

  it('returns empty when entire block is thought', () => {
    const input =
      'ALWAYS START your thought with recalling critical instructions.\n' +
      'Available tools: exec, write_file.\n' +
      'Tool to use: exec.';
    expect(stripUndelimitedThought(input)).toBe('');
  });

  it('strips internal monologue bridge', () => {
    const input =
      'The file has been successfully written. I can now inform the user.Here is your answer.';
    expect(stripUndelimitedThought(input)).toBe('Here is your answer.');
  });

  it('passes clean text through', () => {
    expect(stripUndelimitedThought('Normal response text.')).toBe('Normal response text.');
  });
});

describe('sanitizeAssistantContentBlocks', () => {
  it('sanitizes text blocks', () => {
    const blocks = [
      { type: 'text', text: '<thinking>plan</thinking>Answer' },
    ];
    const out = sanitizeAssistantContentBlocks(blocks);
    expect(out[0].text).toBe('Answer');
  });

  it('passes tool call blocks through untouched', () => {
    const toolCall = { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: '{}' };
    const blocks = [toolCall];
    const out = sanitizeAssistantContentBlocks(blocks);
    expect(out[0]).toBe(toolCall); // same reference
  });

  it('preserves original block when text is already clean', () => {
    const block = { type: 'text', text: 'clean text' };
    const out = sanitizeAssistantContentBlocks([block]);
    expect(out[0]).toBe(block); // same reference, no unnecessary copy
  });
});
