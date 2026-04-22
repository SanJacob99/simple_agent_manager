import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createImageGenerateTool } from './image-generate';
import { createAgentTools } from '../../tool-factory';
import { initializeToolRegistry } from '../../tool-registry';

beforeAll(async () => {
  await initializeToolRegistry();
});

describe('image_generate registration', () => {
  it('creates the tool with any (or no) API key', () => {
    // With no keys at all
    const tool = createImageGenerateTool({ cwd: '/tmp' });
    expect(tool.name).toBe('image_generate');
    expect(tool.label).toBe('Image Generate');
  });

  it('is registered by createAgentTools when image_generate is in names and cwd is set', () => {
    const tools = createAgentTools(
      ['image_generate'],
      [],
      undefined,
      { cwd: '/tmp' },
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain('image_generate');
  });

  it('registers even without any API keys (keys resolve lazily)', () => {
    const tools = createAgentTools(
      ['image_generate'],
      [],
      undefined,
      {
        cwd: '/tmp',
        openaiApiKey: undefined,
        geminiApiKey: undefined,
        getOpenrouterApiKey: undefined,
      },
    );
    expect(tools.map((t) => t.name)).toContain('image_generate');
  });

  it('list action returns empty provider list when no keys configured', async () => {
    const tool = createImageGenerateTool({ cwd: '/tmp' });
    const result = await tool.execute('t1', { action: 'list' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('No image generation providers');
  });

  it('list action shows OpenRouter when lazy key resolver returns a key', async () => {
    const tool = createImageGenerateTool({
      cwd: '/tmp',
      getOpenrouterApiKey: async () => 'test-or-key',
    });
    const result = await tool.execute('t2', { action: 'list' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('OpenRouter');
  });

  it('generate action throws when no providers configured', async () => {
    const tool = createImageGenerateTool({ cwd: '/tmp' });
    await expect(tool.execute('t3', { prompt: 'a duck' })).rejects.toThrow(
      'No image generation providers available',
    );
  });

  it('resolves the lazy OpenRouter key at call time', async () => {
    const getKey = vi.fn(async () => 'dynamic-key');
    const tool = createImageGenerateTool({
      cwd: '/tmp',
      getOpenrouterApiKey: getKey,
    });
    // list action should call the resolver
    await tool.execute('t4', { action: 'list' });
    expect(getKey).toHaveBeenCalledTimes(1);
  });
});
