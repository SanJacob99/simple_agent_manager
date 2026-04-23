import { describe, expect, it } from 'vitest';
import {
  extractSystemAndMessages,
  estimatePayloadBreakdown,
} from './payload-breakdown';

describe('extractSystemAndMessages', () => {
  it('extracts OpenAI-style system message from messages[0]', () => {
    const { systemText, remainingMessages } = extractSystemAndMessages({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(systemText).toBe('You are helpful.');
    expect(remainingMessages).toHaveLength(1);
    expect((remainingMessages[0] as { role: string }).role).toBe('user');
  });

  it('also handles OpenAI "developer" role (newer models)', () => {
    const { systemText, remainingMessages } = extractSystemAndMessages({
      messages: [
        { role: 'developer', content: 'dev instruction' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(systemText).toBe('dev instruction');
    expect(remainingMessages).toHaveLength(1);
  });

  it('extracts Anthropic-style top-level `system` string', () => {
    const { systemText, remainingMessages } = extractSystemAndMessages({
      model: 'claude-3-5',
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(systemText).toBe('You are a helpful assistant.');
    expect(remainingMessages).toHaveLength(1);
  });

  it('extracts Anthropic-style `system` array of text blocks', () => {
    const { systemText } = extractSystemAndMessages({
      system: [
        { type: 'text', text: 'Part A.' },
        { type: 'text', text: 'Part B.' },
      ],
      messages: [],
    });
    expect(systemText).toBe('Part A.Part B.');
  });

  it('extracts pi-core in-state `systemPrompt` string', () => {
    const { systemText } = extractSystemAndMessages({
      systemPrompt: 'core prompt',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(systemText).toBe('core prompt');
  });

  it('returns empty when nothing matches', () => {
    expect(extractSystemAndMessages({})).toEqual({
      systemText: '',
      remainingMessages: [],
    });
  });
});

describe('estimatePayloadBreakdown', () => {
  it('reports non-zero systemPrompt for OpenAI-style payloads (regression: was 0)', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'x'.repeat(40) }, // ~10 tokens
          { role: 'user', content: 'hi' },
        ],
      },
      [],
    );
    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.systemPrompt).toBe(10); // 40 chars / 4
  });

  it('reports non-zero systemPrompt for Anthropic-style payloads', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        system: 'x'.repeat(40),
        messages: [{ role: 'user', content: 'hi' }],
      },
      [],
    );
    expect(breakdown.systemPrompt).toBe(10);
  });

  it('subtracts skill tokens from systemPrompt so sections stay disjoint', () => {
    // system prompt contains 40 chars (~10 tokens), 20 of which are
    // the skill content.
    const skillContent = 'y'.repeat(20); // 5 tokens
    const fullPrompt = 'x'.repeat(20) + skillContent;
    const breakdown = estimatePayloadBreakdown(
      {
        messages: [{ role: 'system', content: fullPrompt }],
      },
      [{ name: 'sk', content: skillContent }],
    );
    expect(breakdown.skills).toBe(5);
    expect(breakdown.systemPrompt).toBe(5); // 10 total - 5 skills
  });

  it('clamps systemPrompt to 0 when skills overshoot the prompt', () => {
    const breakdown = estimatePayloadBreakdown(
      { messages: [{ role: 'system', content: 'short' }] },
      [{ name: 'overflow', content: 'a'.repeat(1000) }],
    );
    expect(breakdown.systemPrompt).toBe(0);
    expect(breakdown.skills).toBeGreaterThan(0);
  });

  it('counts tools via JSON-stringify', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        messages: [],
        tools: [{ name: 'read_file', description: 'x'.repeat(100) }],
      },
      [],
    );
    expect(breakdown.tools).toBeGreaterThan(0);
  });

  it('excludes system entries from the messages count (no double-counting)', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        messages: [
          { role: 'system', content: 'x'.repeat(400) },
          { role: 'user', content: 'short' },
        ],
      },
      [],
    );
    // messages section should not include the 400-char system content.
    const msgOnly = estimatePayloadBreakdown(
      { messages: [{ role: 'user', content: 'short' }] },
      [],
    ).messages;
    expect(breakdown.messages).toBe(msgOnly);
  });
});

describe('estimatePayloadBreakdown per-entry arrays', () => {
  it('produces one skillsEntry per skill, sorted descending by tokens', () => {
    const breakdown = estimatePayloadBreakdown(
      { messages: [] },
      [
        { name: 'small', content: 'x'.repeat(20) },   // 5 tokens
        { name: 'large', content: 'x'.repeat(200) },  // 50 tokens
        { name: 'medium', content: 'x'.repeat(80) },  // 20 tokens
      ],
    );
    expect(breakdown.skillsEntries).toEqual([
      { name: 'large', tokens: 50 },
      { name: 'medium', tokens: 20 },
      { name: 'small', tokens: 5 },
    ]);
    // Aggregate equals the sum of entries.
    const sum = breakdown.skillsEntries.reduce((s, e) => s + e.tokens, 0);
    expect(breakdown.skills).toBe(sum);
  });

  it('produces one toolsEntry per tool (OpenAI shape), name from .function.name', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        messages: [],
        tools: [
          {
            type: 'function',
            function: { name: 'read_file', description: 'a'.repeat(40), parameters: {} },
          },
          {
            type: 'function',
            function: { name: 'exec', description: 'b'.repeat(200), parameters: {} },
          },
        ],
      },
      [],
    );
    const names = breakdown.toolsEntries.map((e) => e.name);
    expect(names).toContain('read_file');
    expect(names).toContain('exec');
    // Sorted desc: exec has more description bytes than read_file.
    expect(breakdown.toolsEntries[0].name).toBe('exec');
  });

  it('falls back to top-level name for Anthropic-style tools', () => {
    const breakdown = estimatePayloadBreakdown(
      {
        messages: [],
        tools: [{ name: 'calculator', description: 'c'.repeat(40), input_schema: {} }],
      },
      [],
    );
    expect(breakdown.toolsEntries).toHaveLength(1);
    expect(breakdown.toolsEntries[0].name).toBe('calculator');
  });

  it('returns empty arrays when nothing is configured', () => {
    const breakdown = estimatePayloadBreakdown({ messages: [] }, []);
    expect(breakdown.skillsEntries).toEqual([]);
    expect(breakdown.toolsEntries).toEqual([]);
  });
});
