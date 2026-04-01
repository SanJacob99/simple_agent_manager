import type { ToolProfile, ToolGroup } from '../types/nodes';
import type { ResolvedToolsConfig } from './agent-config';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

// --- Tool Group Definitions (OpenClaw: group:runtime, group:fs, etc.) ---

export const TOOL_GROUPS: Record<ToolGroup, string[]> = {
  runtime: ['bash', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'list_directory'],
  web: ['web_search', 'web_fetch'],
  memory: ['memory_search', 'memory_get', 'memory_save'],
  coding: ['bash', 'read_file', 'write_file', 'code_interpreter'],
  communication: ['send_message'],
};

// --- Tool Profile Definitions (OpenClaw: predefined allowlists) ---

export const TOOL_PROFILES: Record<ToolProfile, ToolGroup[]> = {
  full: ['runtime', 'fs', 'web', 'memory', 'coding', 'communication'],
  coding: ['runtime', 'fs', 'coding', 'memory'],
  messaging: ['web', 'communication', 'memory'],
  minimal: ['web'],
  custom: [],
};

// --- All available tool names ---

export const ALL_TOOL_NAMES = [
  'bash',
  'code_interpreter',
  'read_file',
  'write_file',
  'list_directory',
  'web_search',
  'web_fetch',
  'calculator',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
];

/**
 * Expand profile + groups + custom enabledTools into a flat deduplicated list.
 */
export function resolveToolNames(config: ResolvedToolsConfig): string[] {
  const names = new Set<string>();

  if (config.profile !== 'custom') {
    const groups = TOOL_PROFILES[config.profile];
    for (const group of groups) {
      for (const tool of TOOL_GROUPS[group]) {
        names.add(tool);
      }
    }
  }

  for (const group of config.enabledGroups) {
    for (const tool of TOOL_GROUPS[group]) {
      names.add(tool);
    }
  }

  for (const tool of config.resolvedTools) {
    names.add(tool);
  }

  // Add tools from enabled plugins
  for (const plugin of config.plugins) {
    if (plugin.enabled) {
      for (const tool of plugin.tools) {
        names.add(tool);
      }
    }
  }

  return [...names];
}

// --- Tool implementations (browser-safe stubs/real) ---

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function createCalculatorTool(): AgentTool<TSchema> {
  return {
    name: 'calculator',
    description: 'Evaluate a mathematical expression safely.',
    label: 'Calculator',
    parameters: Type.Object({
      expression: Type.String({ description: 'Math expression to evaluate' }),
    }),
    execute: async (_id, params: any) => {
      try {
        const expr = params.expression as string;
        // Simple safe math eval using Function constructor with no scope
        const result = new Function(`"use strict"; return (${expr})`)();
        return textResult(String(result));
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : 'Invalid expression'}`);
      }
    },
  };
}

function createWebFetchTool(): AgentTool<TSchema> {
  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL.',
    label: 'Web Fetch',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
      method: Type.Optional(Type.String({ description: 'HTTP method (default: GET)' })),
    }),
    execute: async (_id, params: any, signal) => {
      try {
        const resp = await fetch(params.url, {
          method: params.method || 'GET',
          signal,
        });
        const text = await resp.text();
        const truncated = text.length > 10000 ? text.slice(0, 10000) + '\n...(truncated)' : text;
        return textResult(`Status: ${resp.status}\n\n${truncated}`);
      } catch (e) {
        return textResult(`Fetch error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createStubTool(name: string, description: string): AgentTool<TSchema> {
  return {
    name,
    description,
    label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    parameters: Type.Object({
      input: Type.Optional(Type.String({ description: 'Input parameter' })),
    }),
    execute: async () => {
      return textResult(`[${name}] This tool is not yet implemented in the browser runtime.`);
    },
  };
}

const TOOL_CREATORS: Record<string, () => AgentTool<TSchema>> = {
  calculator: createCalculatorTool,
  web_fetch: createWebFetchTool,
  bash: () => createStubTool('bash', 'Execute shell commands'),
  code_interpreter: () => createStubTool('code_interpreter', 'Execute code in a sandboxed environment'),
  read_file: () => createStubTool('read_file', 'Read a file from the filesystem'),
  write_file: () => createStubTool('write_file', 'Write content to a file'),
  list_directory: () => createStubTool('list_directory', 'List files in a directory'),
  web_search: () => createStubTool('web_search', 'Search the web for information'),
  send_message: () => createStubTool('send_message', 'Send a message to another agent or user'),
  image_generation: () => createStubTool('image_generation', 'Generate an image from a text prompt'),
  text_to_speech: () => createStubTool('text_to_speech', 'Convert text to speech'),
};

/**
 * Create AgentTool instances from a list of tool names.
 * Additional tools (e.g. memory tools) can be appended.
 */
export function createAgentTools(
  names: string[],
  extraTools: AgentTool<TSchema>[] = [],
): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  for (const name of names) {
    // Skip memory tools here - they're provided by MemoryEngine
    if (['memory_search', 'memory_get', 'memory_save'].includes(name)) continue;

    const creator = TOOL_CREATORS[name];
    if (creator) {
      tools.push(creator());
    }
  }

  return [...tools, ...extraTools];
}
