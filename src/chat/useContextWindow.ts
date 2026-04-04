import { useMemo } from 'react';
import { useModelCatalogStore } from '../store/model-catalog-store';
import type { AgentConfig } from '../../shared/agent-config';
import { estimateTokens } from '../../shared/token-estimator';

export type ContextSource = 'override' | 'catalog' | 'default';

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 4096;

export interface ContextWindowInfo {
  contextWindow: number;
  maxTokens: number;
  source: ContextSource;
}

export interface PeripheralReservation {
  label: string;
  type: 'system-prompt' | 'tools' | 'skills' | 'context-engine' | 'other';
  tokenEstimate: number;
  isTodo: boolean; // flag: not yet accurately tracked
}

/**
 * Resolves the effective context window for an agent.
 * Priority: user override → catalog metadata → safe default (128K)
 */
export function useContextWindow(config: AgentConfig | null): ContextWindowInfo {
  const getModelMetadata = useModelCatalogStore((s) => s.getModelMetadata);

  return useMemo(() => {
    if (!config) {
      return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, source: 'default' as ContextSource };
    }

    // 1. Check user overrides
    if (config.modelCapabilities?.contextWindow) {
      return {
        contextWindow: config.modelCapabilities.contextWindow,
        maxTokens: config.modelCapabilities.maxTokens ?? DEFAULT_MAX_TOKENS,
        source: 'override' as ContextSource,
      };
    }

    // 2. Check catalog metadata
    const catalogModel = getModelMetadata(config.provider, config.modelId);
    if (catalogModel?.contextWindow) {
      return {
        contextWindow: catalogModel.contextWindow,
        maxTokens: catalogModel.maxTokens ?? DEFAULT_MAX_TOKENS,
        source: 'catalog' as ContextSource,
      };
    }

    // 3. Safe default
    return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, source: 'default' as ContextSource };
  }, [config, getModelMetadata]);
}

/**
 * Estimates token reservations from connected peripheral nodes.
 */
export function usePeripheralReservations(config: AgentConfig | null): PeripheralReservation[] {
  return useMemo(() => {
    if (!config) return [];
    const reservations: PeripheralReservation[] = [];

    // System prompt
    if (config.systemPrompt) {
      reservations.push({
        label: 'System prompt',
        type: 'system-prompt',
        tokenEstimate: estimateTokens(config.systemPrompt),
        isTodo: false, // We can measure this accurately
      });
    }

    // Tools — estimate full JSON schema
    if (config.tools && config.tools.resolvedTools.length > 0) {
      // Rough estimate: each tool name + schema ≈ tool name length * 15 (for JSON schema overhead)
      // In practice each tool definition in the API payload is ~200-500 tokens
      const toolTokens = config.tools.resolvedTools.reduce((sum, toolName) => {
        // Conservative estimate: tool name + description + schema ≈ 300 tokens per tool
        return sum + Math.max(300, estimateTokens(toolName) * 20);
      }, 0);

      reservations.push({
        label: `Tools (${config.tools.resolvedTools.length})`,
        type: 'tools',
        tokenEstimate: toolTokens,
        isTodo: true, // TODO: wire up actual tool schema serialization for accurate counts
      });
    }

    // Skills injections
    if (config.tools?.skills && config.tools.skills.length > 0) {
      const skillTokens = config.tools.skills.reduce((sum, skill) => {
        return sum + estimateTokens(skill.content);
      }, 0);

      reservations.push({
        label: `Skills (${config.tools.skills.length})`,
        type: 'skills',
        tokenEstimate: skillTokens,
        isTodo: true, // TODO: measure actual injected content after template expansion
      });
    }

    // Context engine system prompt additions
    if (config.contextEngine?.systemPromptAdditions && config.contextEngine.systemPromptAdditions.length > 0) {
      const additionTokens = config.contextEngine.systemPromptAdditions.reduce((sum, addition) => {
        return sum + estimateTokens(addition);
      }, 0);

      reservations.push({
        label: 'Context engine additions',
        type: 'context-engine',
        tokenEstimate: additionTokens,
        isTodo: true, // TODO: context engine should report its actual footprint
      });
    }

    // Connectors (placeholder)
    if (config.connectors.length > 0) {
      reservations.push({
        label: `Connectors (${config.connectors.length})`,
        type: 'other',
        tokenEstimate: config.connectors.length * 50,
        isTodo: true,
      });
    }

    // Agent communication
    if (config.agentComm.length > 0) {
      reservations.push({
        label: `Agent comm (${config.agentComm.length})`,
        type: 'other',
        tokenEstimate: config.agentComm.length * 100,
        isTodo: true,
      });
    }

    return reservations;
  }, [config]);
}
