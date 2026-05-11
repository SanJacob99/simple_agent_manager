import type { AgentConfig, ResolvedVectorDatabaseConfig } from '../../../../shared/agent-config';
import type { VectorDatabaseEngine } from '../../../runtime/vector-database-engine';
import type { RuntimeHints } from '../../tool-module';

export interface VectorToolContext {
  collections: ResolvedVectorDatabaseConfig[];
  getEngine: (label?: string) => Promise<VectorDatabaseEngine | null>;
}

export function resolveVectorContext(
  config: AgentConfig,
  runtime: RuntimeHints,
): VectorToolContext {
  return {
    collections: config.vectorDatabases ?? [],
    getEngine: (label?: string) =>
      runtime.getVectorEngine
        ? runtime.getVectorEngine(label)
        : Promise.resolve(null),
  };
}

/**
 * Resolve the engine the agent meant. When the agent gave an explicit
 * label, look it up; otherwise return the sole attached collection.
 */
export async function resolveEngine(
  ctx: VectorToolContext,
  label: string | undefined,
): Promise<VectorDatabaseEngine> {
  const target = label?.trim() || undefined;
  if (!target && ctx.collections.length > 1) {
    const names = ctx.collections.map((c) => `"${c.label}"`).join(', ');
    throw new Error(
      `Multiple vector collections attached (${names}). Pass a "collection" parameter.`,
    );
  }
  const engine = await ctx.getEngine(target);
  if (!engine) {
    if (target) {
      throw new Error(
        `No vector collection named "${target}" is attached to this agent.`,
      );
    }
    throw new Error('No vector database is attached to this agent.');
  }
  return engine;
}

export function collectionDescriptionSuffix(ctx: VectorToolContext): string {
  if (ctx.collections.length <= 1) return '';
  const names = ctx.collections.map((c) => `"${c.label}"`).join(', ');
  return ` Pass "collection" to choose among: ${names}.`;
}
