import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentConfig } from '../../../shared/agent-config';
import type { RuntimeHints } from '../../tools/tool-module';
import { getOrCreateVectorEngine } from '../vector-engine-registry';
import type { VectorToolContext } from './shared-context';
import { createVectorSearchTool } from './vector-search';
import { createVectorUpsertTool } from './vector-upsert';
import { createVectorDeleteTool } from './vector-delete';
import { createVectorGetTool } from './vector-get';

/**
 * Build the four vector tools for an agent.
 *
 * Mirrors `MemoryEngine.createMemoryTools()`: tools are produced by the
 * peripheral itself and appended to the agent's tool list at runtime
 * construction time. There is no user-facing on/off switch — wiring a
 * `vectorDatabase` node to an agent is the enable signal, and the model
 * sees the four tools as soon as the runtime boots.
 *
 * Returns an empty list when no `vectorDatabase` is attached so the model
 * is never shown tools that have nothing to operate on.
 */
export function createVectorTools(
  config: AgentConfig,
  runtime: RuntimeHints,
): AgentTool<TSchema>[] {
  const collections = config.vectorDatabases ?? [];
  if (collections.length === 0) return [];

  const ctx: VectorToolContext = {
    collections,
    getEngine: (label?: string) => getOrCreateVectorEngine(config, label, runtime),
  };

  return [
    createVectorSearchTool(ctx),
    createVectorUpsertTool(ctx),
    createVectorDeleteTool(ctx),
    createVectorGetTool(ctx),
  ];
}
