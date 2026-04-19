import type { NodeType, FlowNodeData } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';

export function getDefaultNodeData(nodeType: NodeType): FlowNodeData {
  switch (nodeType) {
    case 'agent':
      return {
        type: 'agent',
        name: '',
        nameConfirmed: false,
        systemPrompt: 'You are a helpful assistant.',
        modelId: 'anthropic/claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        description: '',
        tags: [],
        modelCapabilities: {},
        systemPromptMode: 'append' as SystemPromptMode,
        showReasoning: false,
        verbose: false,
        workingDirectory: '',
      };
    case 'memory':
      return {
        type: 'memory',
        label: 'Memory',
        backend: 'builtin',
        maxSessionMessages: 100,
        persistAcrossSessions: false,
        compactionEnabled: false,
        compactionStrategy: 'summary',
        compactionThreshold: 0.8,
        exposeMemorySearch: true,
        exposeMemoryGet: true,
        exposeMemorySave: true,
        searchMode: 'hybrid',
        externalEndpoint: '',
        externalApiKey: '',
      };
    case 'tools':
      return {
        type: 'tools',
        label: 'Tools',
        profile: 'custom',
        // HITL (ask_user + confirm_action) is checked by default. The tools
        // node still shows the checkboxes, but they are locked unless the
        // user explicitly enables "Dangerous Fully Auto" mode in Settings.
        enabledTools: ['ask_user', 'confirm_action'],
        enabledGroups: [],
        skills: [],
        plugins: [],
        subAgentSpawning: false,
        maxSubAgents: 3,
        toolSettings: {
          exec: {
            cwd: '',
            sandboxWorkdir: false,
            skill: '',
          },
          codeExecution: {
            apiKey: '',
            model: '',
            skill: '',
          },
          webSearch: {
            tavilyApiKey: '',
            skill: '',
          },
          image: {
            openaiApiKey: '',
            geminiApiKey: '',
            preferredModel: '',
            skill: '',
          },
          canva: {
            portRangeStart: 5173,
            portRangeEnd: 5273,
            skill: '',
          },
          textToSpeech: {
            preferredProvider: '',
            elevenLabsApiKey: '',
            elevenLabsDefaultVoice: '',
            elevenLabsDefaultModel: '',
            openaiVoice: '',
            openaiModel: '',
            geminiVoice: '',
            geminiModel: '',
            microsoftApiKey: '',
            microsoftRegion: '',
            microsoftDefaultVoice: '',
            minimaxApiKey: '',
            minimaxGroupId: '',
            minimaxDefaultVoice: '',
            minimaxDefaultModel: '',
            openrouterVoice: '',
            openrouterModel: '',
            skill: '',
          },
          musicGenerate: {
            preferredProvider: '',
            geminiModel: '',
            minimaxModel: '',
            skill: '',
          },
        },
      };
    case 'skills':
      return {
        type: 'skills',
        label: 'Skills',
        enabledSkills: ['code_generation', 'summarization'],
      };
    case 'contextEngine':
      return {
        type: 'contextEngine',
        label: 'Context Engine',
        tokenBudget: 128000,
        reservedForResponse: 4096,
        ownsCompaction: true,
        compactionStrategy: 'trim-oldest',
        compactionTrigger: 'auto',
        compactionThreshold: 0.8,
        autoFlushBeforeCompact: true,
        ragEnabled: false,
        ragTopK: 5,
        ragMinScore: 0.7,
        bootstrapMaxChars: 20000,
        bootstrapTotalMaxChars: 150000,
      };
    case 'agentComm':
      return {
        type: 'agentComm',
        label: 'Agent Comm',
        targetAgentNodeId: null,
        protocol: 'direct',
      };
    case 'connectors':
      return {
        type: 'connectors',
        label: 'Connector',
        connectorType: 'rest-api',
        config: {},
      };
    case 'storage':
      return {
        type: 'storage',
        label: 'Storage',
        backendType: 'filesystem',
        storagePath: '~/.simple-agent-manager/storage',
        sessionRetention: 50,
        memoryEnabled: true,
        dailyMemoryEnabled: true,
        dailyResetEnabled: true,
        dailyResetHour: 4,
        idleResetEnabled: false,
        idleResetMinutes: 60,
        parentForkMaxTokens: 100000,
        maintenanceMode: 'warn',
        pruneAfterDays: 30,
        maxEntries: 500,
        rotateBytes: 10_485_760,
        resetArchiveRetentionDays: 30,
        maxDiskBytes: 0,
        highWaterPercent: 80,
        maintenanceIntervalMinutes: 60,
      };
    case 'vectorDatabase':
      return {
        type: 'vectorDatabase',
        label: 'Vector DB',
        provider: 'chromadb',
        collectionName: 'default',
        connectionString: '',
      };
    case 'cron':
      return {
        type: 'cron',
        label: 'Cron Job',
        schedule: '0 9 * * *',
        prompt: '',
        enabled: true,
        sessionMode: 'persistent',
        timezone: 'local',
        maxRunDurationMs: 300000,
        retentionDays: 7,
      };
    case 'provider':
      return {
        type: 'provider',
        label: 'Provider',
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      };
  }
}
