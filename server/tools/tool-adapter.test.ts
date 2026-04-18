import { describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  adaptAgentTool,
  coerceParamsRecord,
  isToolErrorDetails,
} from './tool-adapter';

vi.mock('../logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logConsoleAndFile: vi.fn(),
}));

function makeTool(
  name: string,
  execute: AgentTool['execute'],
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({ input: Type.Optional(Type.String()) }),
    execute,
  };
}

describe('coerceParamsRecord', () => {
  it('passes plain objects through', () => {
    expect(coerceParamsRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it('parses JSON-string params', () => {
    expect(coerceParamsRecord('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns original value for unparseable strings', () => {
    expect(coerceParamsRecord('not json')).toBe('not json');
  });

  it('returns original value for JSON that is not an object', () => {
    expect(coerceParamsRecord('[1,2,3]')).toBe('[1,2,3]');
  });
});

describe('adaptAgentTool', () => {
  it('passes successful results through untouched when well-formed', async () => {
    const result: AgentToolResult<undefined> = {
      content: [{ type: 'text', text: 'ok' }],
      details: undefined,
    };
    const tool = makeTool('calculator', async () => result);
    const adapted = adaptAgentTool(tool);

    const out = await adapted.execute('id-1', { input: 'x' });
    expect(out).toEqual(result);
  });

  it('coerces stringified JSON params before calling execute', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: undefined,
    }));
    const tool = makeTool('calculator', execute as unknown as AgentTool['execute']);
    const adapted = adaptAgentTool(tool);

    await adapted.execute('id-2', '{"input":"42"}' as unknown as { input?: string });
    expect(execute).toHaveBeenCalledWith(
      'id-2',
      { input: '42' },
      undefined,
      undefined,
    );
  });

  it('normalizes results that lack a content[] array', async () => {
    const tool = makeTool('weird', async () => ({ detailsOnly: true }) as unknown as AgentToolResult<any>);
    const adapted = adaptAgentTool(tool);

    const out = await adapted.execute('id-3', {});
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content.length).toBeGreaterThan(0);
  });

  it('returns a structured error result when execute throws', async () => {
    const tool = makeTool('boom', async () => {
      throw new Error('kaboom');
    });
    const adapted = adaptAgentTool(tool);

    const out = await adapted.execute('id-4', { input: 'x' });
    expect(isToolErrorDetails(out.details)).toBe(true);
    expect((out.details as { error: string }).error).toBe('kaboom');
    expect((out.details as { tool: string }).tool).toBe('boom');
    expect(Array.isArray(out.content)).toBe(true);
  });

  it('re-throws when the signal is aborted', async () => {
    const controller = new AbortController();
    const tool = makeTool('abortable', async (_id, _p, signal) => {
      controller.abort();
      const err = new Error('cancelled');
      err.name = 'AbortError';
      throw err;
    });
    const adapted = adaptAgentTool(tool);

    await expect(adapted.execute('id-5', {}, controller.signal)).rejects.toThrow('cancelled');
  });

  it('re-throws AbortError even when signal is not present', async () => {
    const tool = makeTool('abortable2', async () => {
      const err = new Error('cancelled');
      err.name = 'AbortError';
      throw err;
    });
    const adapted = adaptAgentTool(tool);

    await expect(adapted.execute('id-6', {})).rejects.toThrow('cancelled');
  });

  it('preserves the original tool name on the adapted tool', () => {
    const tool = makeTool('Calculator', async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: undefined,
    }));
    const adapted = adaptAgentTool(tool);
    expect(adapted.name).toBe('Calculator');
  });
});

describe('isToolErrorDetails', () => {
  it('returns true for structured error payloads', () => {
    expect(isToolErrorDetails({ status: 'error', tool: 't', error: 'boom' })).toBe(true);
  });

  it('returns false for ok payloads', () => {
    expect(isToolErrorDetails({ status: 'ok' })).toBe(false);
    expect(isToolErrorDetails(undefined)).toBe(false);
    expect(isToolErrorDetails(null)).toBe(false);
  });
});
