import type { NodeType, FlowNodeData } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';
import { DEFAULT_COORDINATION_CONFIG } from '../../shared/coordination-types';

export function getDefaultNodeData(nodeType: NodeType): FlowNodeData {
  switch (nodeType) {
    case 'agent':
      return {
        type: 'agent',
        name: '',
        nameConfirmed: false,
        systemPrompt: 'You are a helpful assistant.',
        modelId: 'anthropic/claude-sonnet-4-6',
        thinkingLevel: 'off',
        description: '',
        tags: [],
        modelCapabilities: {},
        systemPromptMode: 'append' as SystemPromptMode,
        showReasoning: false,
        verbose: false,
        coordination: { ...DEFAULT_COORDINATION_CONFIG },
        workingDirectory: '',
      };
    case 'memory':
      return {
        type: 'memory',
        label: 'Memory',
        autoLoadLongTerm: true,
        longTermMaxBytes: 8000,
        autoLoadShortTermDays: 2,
        compactionEnabled: false,
        compactionAfterDays: 7,
        compactionStrategy: 'summary',
        searchMode: 'keyword',
        exposeMemorySearch: true,
        exposeMemoryGet: true,
        exposeMemorySave: true,
      };
    case 'tools':
      return {
        type: 'tools',
        label: 'Tools',
        profile: 'full',
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
          browser: {
            userDataDir: '',
            headless: false,
            viewportWidth: 1280,
            viewportHeight: 800,
            timeoutMs: 30000,
            autoScreenshot: true,
            screenshotFormat: 'jpeg',
            screenshotQuality: 60,
            stealth: true,
            locale: '',
            timezone: '',
            userAgent: '',
            cdpEndpoint: '',
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
        compactionStrategy: 'summary',
        summaryModelId: '',
        compactionTrigger: 'auto',
        compactionThreshold: 0.8,
        postCompactionTokenTarget: 50000,
        autoFlushBeforeCompact: true,
        ragEnabled: false,
        ragTopK: 5,
        ragMinScore: 0.7,
      };
    case 'agentComm':
      return {
        type: 'agentComm',
        label: 'Agent Comm',
        targetAgentNodeId: null,
        protocol: 'direct',
        maxTurns: 10,
        maxDepth: 3,
        tokenBudget: 100_000,
        rateLimitPerMinute: 30,
        messageSizeCap: 16_000,
        direction: 'bidirectional',
      };
    case 'connectors':
      return {
        type: 'connectors',
        label: 'Connector',
        connectorId: '',
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
        dailyResetEnabled: false,
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
        provider: 'sqlite-vec',
        collectionName: 'default',
        connectionString: '',
        storagePath: '.sam/vector',
        embedding: {
          provider: 'openrouter',
          model: 'openai/text-embedding-3-small',
        },
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
    case 'mcp':
      return {
        type: 'mcp',
        label: 'MCP',
        transport: 'stdio',
        command: '',
        args: [],
        env: {},
        cwd: '',
        url: '',
        headers: {},
        toolPrefix: '',
        allowedTools: [],
        autoConnect: true,
      };
    case 'guardrails':
      return {
        type: 'guardrails',
        label: 'Guardrails',
        enabled: true,
        checkInput: true,
        checkOutput: true,
        maxInputChars: 8000,
        blockedTerms: [],
        piiCategories: [],
        action: 'block',
        blockMessage: '',
      };
    case 'telemetry':
      return {
        type: 'telemetry',
        label: 'Telemetry',
        enabled: true,
        captureTokens: true,
        captureCost: true,
        captureLatency: true,
        captureToolCalls: true,
        exporter: 'console',
        otlpEndpoint: 'http://localhost:4318/v1/traces',
        otlpHeaders: {},
        filePath: '.sam/telemetry.jsonl',
        serviceName: 'simple-agent-manager',
        sampleRate: 1,
        redactContent: false,
      };
    case 'structuredOutput':
      return {
        type: 'structuredOutput',
        label: 'Structured Output',
        enabled: true,
        schemaName: 'response',
        schema: JSON.stringify(
          {
            type: 'object',
            properties: {
              answer: { type: 'string' },
            },
            required: ['answer'],
            additionalProperties: false,
          },
          null,
          2,
        ),
        strict: true,
        onValidationError: 'repair',
        maxRepairAttempts: 1,
        injectSchemaIntoPrompt: true,
      };
    case 'budget':
      return {
        type: 'budget',
        label: 'Budget',
        enabled: true,
        maxUsdPerRun: 0,
        maxUsdPerDay: 0,
        maxTokensPerRun: 0,
        maxToolCallsPerRun: 0,
        maxRunsPerMinute: 0,
        degradePolicy: 'warn',
        downshiftModelId: '',
        blockMessage: '',
      };
    case 'evals':
      return {
        type: 'evals',
        label: 'Evals',
        enabled: true,
        cases: [
          {
            id: 'smoke-1',
            input: 'Reply with the single word: ready',
            expected: 'ready',
            grader: 'contains',
            weight: 1,
          },
        ],
        defaultGrader: 'contains',
        passThreshold: 0.8,
        judgeModelId: '',
        judgePrompt:
          'Score how well the reply satisfies the expected answer. Respond with a score from 0 to 1.',
        maxConcurrency: 4,
        failOnRegression: false,
      };
    case 'reflection':
      return {
        type: 'reflection',
        label: 'Reflection',
        enabled: true,
        rubric:
          'The answer is correct, complete, directly addresses the request, and is clearly written.',
        scoreThreshold: 0.8,
        maxRevisions: 1,
        criticModelId: '',
        critiquePrompt: '',
        onExhaustion: 'use_best',
        injectRubricIntoPrompt: false,
      };
    case 'a2a':
      return {
        type: 'a2a',
        label: 'A2A Interop',
        enabled: true,
        role: 'both',
        agentName: '',
        agentDescription: 'An agent exposed over the Agent-to-Agent protocol.',
        agentVersion: '1.0.0',
        serverPath: '/a2a',
        advertisedSkills: [],
        streaming: true,
        pushNotifications: false,
        requireAuth: false,
        inboundTokenEnv: '',
        remotes: [],
        maxConcurrentTasks: 4,
        taskTimeoutMs: 120000,
      };
    case 'subAgent':
      return {
        type: 'subAgent',
        name: '',
        description: '',
        systemPrompt:
          'You are a focused assistant. Complete the parent agent\'s task and report back concisely.',
        modelIdMode: 'inherit',
        modelId: '',
        thinkingLevelMode: 'inherit',
        thinkingLevel: 'off',
        modelCapabilities: {},
        overridableFields: [],
        workingDirectoryMode: 'derived',
        workingDirectory: '',
        recursiveSubAgentsEnabled: false,
      };
  }
}
