import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';

export interface WebSearchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface WebFetchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface WebSearchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebSearchToolContext) => AgentTool<TSchema>;
}

export interface WebFetchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebFetchToolContext) => AgentTool<TSchema>;
}
