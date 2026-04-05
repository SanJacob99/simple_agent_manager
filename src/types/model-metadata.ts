export type ModelInputModality = 'text' | 'image';

export interface ModelCostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelTopProviderInfo {
  contextLength?: number;
  maxCompletionTokens?: number;
  isModerated?: boolean;
}

export interface ModelCapabilityOverrides {
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  description?: string;
  modelName?: string;
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
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  raw?: any;
}
