import { describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createAgentTools } from './tool-factory';

describe('createAgentTools', () => {
  it('replaces enabled web tools with provider-backed implementations', () => {
    const createWebSearchTool = vi.fn(() => ({
      name: 'web_search',
      description: 'Provider-backed web search',
      label: 'Provider Search',
      parameters: Type.Object({ query: Type.String() }),
      execute: vi.fn(),
    }));
    const createWebFetchTool = vi.fn(() => ({
      name: 'web_fetch',
      description: 'Provider-backed web fetch',
      label: 'Provider Fetch',
      parameters: Type.Object({ url: Type.String() }),
      execute: vi.fn(),
    }));

    const tools = createAgentTools(['web_search', 'web_fetch'], [], {
      plugin: {
        id: 'provider-test',
        name: 'Provider Test',
        description: 'test plugin',
        runtimeProviderId: 'provider-test',
        defaultBaseUrl: 'https://provider.test',
        auth: [],
        webSearch: {
          id: 'provider-search',
          label: 'Provider Search',
          createTool: createWebSearchTool,
        },
        webFetch: {
          id: 'provider-fetch',
          label: 'Provider Fetch',
          createTool: createWebFetchTool,
        },
      },
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
    });

    expect(createWebSearchTool).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
    });
    expect(createWebFetchTool).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
    });
    expect(tools.map((tool) => tool.description)).toEqual([
      'Provider-backed web search',
      'Provider-backed web fetch',
    ]);
  });

  it('does not inject provider-backed web tools that were not enabled', () => {
    const createWebSearchTool = vi.fn();

    const tools = createAgentTools(['calculator'], [], {
      plugin: {
        id: 'provider-test',
        name: 'Provider Test',
        description: 'test plugin',
        runtimeProviderId: 'provider-test',
        defaultBaseUrl: 'https://provider.test',
        auth: [],
        webSearch: {
          id: 'provider-search',
          label: 'Provider Search',
          createTool: createWebSearchTool,
        },
      },
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
    });

    expect(createWebSearchTool).not.toHaveBeenCalled();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('calculator');
  });
});
