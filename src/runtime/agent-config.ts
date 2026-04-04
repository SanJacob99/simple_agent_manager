// Re-export everything from the shared location.
// This file exists for backwards compatibility during the migration.
export type {
  MemoryBackend,
  ToolProfile,
  ToolGroup,
  CompactionStrategy,
  SkillDefinition,
  PluginDefinition,
  ModelInputModality,
  ModelCostInfo,
  ModelCapabilityOverrides,
  DiscoveredModelMetadata,
  AgentConfig,
  ResolvedMemoryConfig,
  ResolvedToolsConfig,
  ResolvedContextEngineConfig,
  ResolvedConnectorConfig,
  ResolvedAgentCommConfig,
  ResolvedStorageConfig,
  ResolvedVectorDatabaseConfig,
} from '../../shared/agent-config';
