import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graph-store';
import { useModelCatalogStore } from '../store/model-catalog-store';
import type { ContextEngineNodeData, AgentNodeData } from '../types/nodes';

export const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-3-5-20241022': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'o3-mini': 200000,
};

export function useContextEngineSync(nodeId: string, data: ContextEngineNodeData) {
  const update = useGraphStore((s) => s.updateNodeData);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const getModelMetadata = useModelCatalogStore((s) => s.getModelMetadata);

  const connectedAgentEdge = edges.find((e) => e.source === nodeId);
  const connectedAgent = connectedAgentEdge
    ? nodes.find((n) => n.id === connectedAgentEdge.target && n.data.type === 'agent')
    : undefined;

  const agentData = connectedAgent?.data as AgentNodeData | undefined;
  const provider = agentData?.provider;
  const modelId = agentData?.modelId;

  // Try catalog first, then agent overrides, then well-known defaults
  const catalogMeta = provider && modelId ? getModelMetadata(provider, modelId) : undefined;
  const modelContextWindow =
    catalogMeta?.contextWindow ??
    agentData?.modelCapabilities?.contextWindow ??
    (modelId ? KNOWN_CONTEXT_WINDOWS[modelId] : undefined);

  // Ensure we don't overwrite manual edits unless the actual model capability changes 
  const lastInheritedRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // If the model window changes from what we last inherited, we should sync
    // This allows the user to manually override data.tokenBudget in the UI without us instantly reverting it,
    // as long as the modelContextWindow continues to stay the same.
    if (modelContextWindow && modelContextWindow !== lastInheritedRef.current) {
      lastInheritedRef.current = modelContextWindow;
      
      const timeout = setTimeout(() => {
        if (data.tokenBudget !== modelContextWindow) {
          update(nodeId, { tokenBudget: modelContextWindow });
        }
      }, 50);
      return () => clearTimeout(timeout);
    } 
    
    // Fallback if disconnected
    if (!modelContextWindow && lastInheritedRef.current !== undefined) {
       lastInheritedRef.current = undefined;
       const timeout = setTimeout(() => {
          if (data.tokenBudget !== 128000) {
            update(nodeId, { tokenBudget: 128000 });
          }
       }, 50);
       return () => clearTimeout(timeout);
    }
  }, [modelContextWindow, nodeId, data.tokenBudget, update]);

  return {
    connectedAgent,
    agentData,
    modelId,
    modelContextWindow,
  };
}
