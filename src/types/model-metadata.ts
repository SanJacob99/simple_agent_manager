export type ModelInputModality = 'text' | 'image';

export interface ModelCostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCapabilityOverrides {
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
}

export interface DiscoveredModelMetadata {
  id: string;
  provider: string;
  name?: string;
  description?: string;
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  raw?: any;
}
