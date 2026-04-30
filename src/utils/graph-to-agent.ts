import type { AppNode } from '../types/nodes';
import type { Edge } from '@xyflow/react';
import type { AgentConfig, ResolvedProviderConfig, SystemPromptMode } from '../../shared/agent-config';
import { resolveToolNames, IMPLEMENTED_TOOL_NAMES } from '../../shared/resolve-tool-names';
import { buildSystemPrompt } from '../../shared/system-prompt-builder';
import { eligibleBundledSkills } from '../../shared/default-tool-skills';
import { useToolCatalogStore } from '../store/tool-catalog-store';

export function resolveAgentConfig(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  options: { safetyGuardrails?: string } = {},
): AgentConfig | null {
  const agentNode = nodes.find(
    (n) => n.id === agentNodeId && n.data.type === 'agent',
  );
  if (!agentNode || agentNode.data.type !== 'agent') return null;

  const data = agentNode.data;

  // Find all nodes connected to this agent (peripheral -> agent edges)
  const connectedEdges = edges.filter((e) => e.target === agentNodeId);
  const connectedNodes = connectedEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  // --- Provider ---
  const providerNode = connectedNodes.find((n) => n.data.type === 'provider');
  const providerConfig: ResolvedProviderConfig =
    providerNode && providerNode.data.type === 'provider'
      ? {
          pluginId: providerNode.data.pluginId as string,
          authMethodId: providerNode.data.authMethodId as string,
          envVar: providerNode.data.envVar as string,
          baseUrl: providerNode.data.baseUrl as string,
        }
      : { pluginId: '', authMethodId: '', envVar: '', baseUrl: '' };

  // --- Memory ---
  const memoryNode = connectedNodes.find((n) => n.data.type === 'memory');
  const memory = memoryNode && memoryNode.data.type === 'memory'
    ? {
        backend: memoryNode.data.backend,
        maxSessionMessages: memoryNode.data.maxSessionMessages,
        persistAcrossSessions: memoryNode.data.persistAcrossSessions,
        compactionEnabled: memoryNode.data.compactionEnabled,
        compactionThreshold: memoryNode.data.compactionThreshold,
        compactionStrategy: memoryNode.data.compactionStrategy,
        exposeMemorySearch: memoryNode.data.exposeMemorySearch,
        exposeMemoryGet: memoryNode.data.exposeMemoryGet,
        exposeMemorySave: memoryNode.data.exposeMemorySave,
        searchMode: memoryNode.data.searchMode,
        externalEndpoint: memoryNode.data.externalEndpoint,
        externalApiKey: memoryNode.data.externalApiKey,
      }
    : null;

  // --- Tools ---
  const toolsNode = connectedNodes.find((n) => n.data.type === 'tools');
  const skillsNodes = connectedNodes.filter((n) => n.data.type === 'skills');

  // SkillDefinition entries live in AgentConfig.tools.skills and are tracked
  // separately from bundled skill references. They cover:
  //   - custom skills configured on the Tools Node
  //   - standalone Skills Node names (declarative tags; empty content)
  //   - user-authored inline overrides in toolSettings.<tool>.skill
  //
  // Bundled skill references are composed later for the Skills section of
  // the system prompt; they never round-trip through this list because the
  // guidance lives on disk at <SAM_BUNDLED_ROOT>/<id>/SKILL.md.
  const allSkills = toolsNode && toolsNode.data.type === 'tools'
    ? [...toolsNode.data.skills]
    : [];

  for (const sn of skillsNodes) {
    if (sn.data.type === 'skills') {
      for (const skillName of sn.data.enabledSkills) {
        allSkills.push({
          id: skillName,
          name: skillName,
          content: '',
          injectAs: 'system-prompt' as const,
        });
      }
    }
  }

  // Track which tool ids already have an author-written inline override so
  // we don't also emit the bundled reference for the same tool.
  const overriddenToolIds = new Set<string>();
  if (toolsNode && toolsNode.data.type === 'tools') {
    const ts = toolsNode.data.toolSettings;
    const addInline = (id: string, label: string, text: string | undefined) => {
      if (!text?.trim()) return;
      allSkills.push({
        id: `tool-skill-${id}`,
        name: `${label} (inline override)`,
        content: text.trim(),
        injectAs: 'system-prompt' as const,
      });
      overriddenToolIds.add(id);
    };
    addInline('exec', 'exec tool guidance', ts?.exec?.skill);
    addInline('code-execution', 'code_execution tool guidance', ts?.codeExecution?.skill);
    addInline('web-search', 'web_search tool guidance', ts?.webSearch?.skill);
    addInline('image', 'image tool guidance', ts?.image?.skill);
    addInline('canva', 'canva tool guidance', ts?.canva?.skill);
    addInline('browser', 'browser tool guidance', ts?.browser?.skill);
    addInline('text-to-speech', 'text_to_speech tool guidance', ts?.textToSpeech?.skill);
    addInline('music-generate', 'music_generate tool guidance', ts?.musicGenerate?.skill);
  }

  const toolsConfig = toolsNode && toolsNode.data.type === 'tools'
    ? {
        profile: toolsNode.data.profile,
        // Store raw per-tool selections; full resolution happens once at runtime
        resolvedTools: toolsNode.data.enabledTools,
        enabledGroups: toolsNode.data.enabledGroups,
        skills: allSkills,
        plugins: toolsNode.data.plugins,
        subAgentSpawning: toolsNode.data.subAgentSpawning,
        maxSubAgents: toolsNode.data.maxSubAgents,
      }
    : null;

  // --- Context Engine ---
  const contextNode = connectedNodes.find((n) => n.data.type === 'contextEngine');
  const contextEngine = contextNode && contextNode.data.type === 'contextEngine'
    ? {
        tokenBudget: contextNode.data.tokenBudget,
        reservedForResponse: contextNode.data.reservedForResponse,
        compactionStrategy: contextNode.data.compactionStrategy,
        summaryModelId: contextNode.data.summaryModelId ?? '',
        compactionTrigger: contextNode.data.compactionTrigger,
        compactionThreshold: contextNode.data.compactionThreshold,
        postCompactionTokenTarget: contextNode.data.postCompactionTokenTarget,
        autoFlushBeforeCompact: contextNode.data.autoFlushBeforeCompact,
        ragEnabled: contextNode.data.ragEnabled,
        ragTopK: contextNode.data.ragTopK,
        ragMinScore: contextNode.data.ragMinScore,
      }
    : null;

  // --- Connectors ---
  const connectors = connectedNodes
    .filter((n) => n.data.type === 'connectors')
    .map((n) => {
      if (n.data.type !== 'connectors') throw new Error('unreachable');
      return {
        label: n.data.label,
        connectorType: n.data.connectorType,
        config: n.data.config,
      };
    });

  // --- Agent Communication ---
  const agentComm = connectedNodes
    .filter((n) => n.data.type === 'agentComm')
    .map((n) => {
      if (n.data.type !== 'agentComm') throw new Error('unreachable');
      return {
        label: n.data.label,
        targetAgentNodeId: n.data.targetAgentNodeId,
        protocol: n.data.protocol,
      };
    });

  // --- Storage ---
  const storageNode = connectedNodes.find((n) => n.data.type === 'storage');
  const storage = storageNode && storageNode.data.type === 'storage'
    ? {
        label: storageNode.data.label,
        backendType: storageNode.data.backendType,
        storagePath: storageNode.data.storagePath,
        sessionRetention: storageNode.data.sessionRetention,
        memoryEnabled: storageNode.data.memoryEnabled,
        dailyMemoryEnabled: storageNode.data.dailyMemoryEnabled,
        dailyResetEnabled: storageNode.data.dailyResetEnabled,
        dailyResetHour: storageNode.data.dailyResetHour,
        idleResetEnabled: storageNode.data.idleResetEnabled,
        idleResetMinutes: storageNode.data.idleResetMinutes,
        parentForkMaxTokens: storageNode.data.parentForkMaxTokens,
        maintenanceMode: storageNode.data.maintenanceMode,
        pruneAfterDays: storageNode.data.pruneAfterDays,
        maxEntries: storageNode.data.maxEntries,
        rotateBytes: storageNode.data.rotateBytes,
        resetArchiveRetentionDays: storageNode.data.resetArchiveRetentionDays,
        maxDiskBytes: storageNode.data.maxDiskBytes,
        highWaterPercent: storageNode.data.highWaterPercent,
        maintenanceIntervalMinutes: storageNode.data.maintenanceIntervalMinutes,
      }
    : null;

  // --- Vector Databases ---
  const vectorDatabases = connectedNodes
    .filter((n) => n.data.type === 'vectorDatabase')
    .map((n) => {
      if (n.data.type !== 'vectorDatabase') throw new Error('unreachable');
      return {
        label: n.data.label,
        provider: n.data.provider,
        collectionName: n.data.collectionName,
        connectionString: n.data.connectionString,
      };
    });

  // --- Cron Jobs ---
  const crons = connectedNodes
    .filter((n) => n.data.type === 'cron')
    .map((n) => {
      if (n.data.type !== 'cron') throw new Error('unreachable');
      return {
        cronNodeId: n.id,
        label: n.data.label,
        schedule: n.data.schedule,
        prompt: n.data.prompt,
        enabled: n.data.enabled,
        sessionMode: n.data.sessionMode,
        timezone: n.data.timezone,
        maxRunDurationMs: n.data.maxRunDurationMs,
        retentionDays: n.data.retentionDays,
      };
    });

  // --- MCP Servers ---
  // Each MCP node resolves to a ResolvedMcpConfig. The node id is kept as
  // `mcpNodeId` so the server can push `mcp:status` events back to the UI
  // and the MCPNode component can light up a live connection hint.
  const mcps = connectedNodes
    .filter((n) => n.data.type === 'mcp')
    .map((n) => {
      if (n.data.type !== 'mcp') throw new Error('unreachable');
      return {
        mcpNodeId: n.id,
        label: n.data.label,
        transport: n.data.transport,
        command: n.data.command,
        args: n.data.args,
        env: n.data.env,
        cwd: n.data.cwd,
        url: n.data.url,
        headers: n.data.headers,
        toolPrefix: n.data.toolPrefix,
        allowedTools: n.data.allowedTools,
        autoConnect: n.data.autoConnect,
      };
    });

  // --- Build structured system prompt ---
  const agentMode = (data as any).systemPromptMode as SystemPromptMode | undefined;
  const mode: SystemPromptMode = agentMode === 'manual' ? 'manual' : 'append';

  const resolvedToolNamesList = toolsConfig ? resolveToolNames(toolsConfig) : [];
  // System-prompt "Tools available" summary is filtered so the model is
  // only told about tools it can actually call. The hardcoded
  // `IMPLEMENTED_TOOL_NAMES` set is the offline baseline; the live
  // `tool-catalog-store` (populated from `GET /api/tools` at app mount)
  // adds any user-installed modules from `server/tools/user/` on top of
  // that so they get advertised too.
  const catalogState = useToolCatalogStore.getState();
  const catalogKnown = catalogState.loaded
    ? new Set(catalogState.tools.map((t) => t.name))
    : null;
  const toolsSummary = toolsConfig
    ? resolvedToolNamesList
        .filter((t) => IMPLEMENTED_TOOL_NAMES.has(t) || catalogKnown?.has(t))
        .join(', ')
    : null;

  // Compose the Skills section of the system prompt. Three buckets:
  //   1. Available — compact list of bundled SKILL.md files the agent can
  //      `read_file` on demand. Skipped for any tool with an inline override.
  //   2. Tags — declarative skill names from standalone Skills Nodes.
  //   3. Inline — author-written overrides and custom SkillDefinitions with
  //      full content baked into the prompt.
  const bundledRefs = eligibleBundledSkills(resolvedToolNamesList)
    .filter((ref) => !overriddenToolIds.has(ref.id));
  const bareSkills = allSkills.filter((s) => !s.content.trim());
  const richSkills = allSkills.filter((s) => s.content.trim());

  const skillsSections: string[] = [];
  if (bundledRefs.length > 0) {
    const preamble =
      'Load a skill with `read_file` only when its topic becomes relevant to the current task — don\'t preload them all.';
    const lines = bundledRefs
      .map((ref) => `- ${ref.id} (${ref.location}) — ${ref.description} → ${ref.path}`)
      .join('\n');
    skillsSections.push(`### Available\n\n${preamble}\n\n${lines}`);
  }
  if (bareSkills.length > 0) {
    skillsSections.push(
      `### Tags\n\n${bareSkills.map((s) => `- ${s.name}`).join('\n')}`,
    );
  }
  for (const s of richSkills) {
    skillsSections.push(`### ${s.name}\n\n${s.content.trim()}`);
  }

  const skillsSummary = skillsSections.length > 0 ? skillsSections.join('\n\n') : null;

  // Hardcoded bootstrap truncation limits -- these are no longer user-
  // facing on the Context Engine node. The system prompt builder still
  // needs them to cap workspace bootstrap file content, so feed the
  // same defaults the old UI used.
  const bootstrapMaxChars = 20000;
  const bootstrapTotalMaxChars = 150000;

  const workspacePath = data.workingDirectory || null;

  // Resolve the user's local timezone and current wall-clock time so
  // the Time section has real content. These are browser-available
  // and safe to call at prompt-build time.
  let timezone: string | null = null;
  let nowIso: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    nowIso = new Date().toISOString();
  } catch {
    // Non-browser / exotic runtime -- leave both null; builder falls back.
  }

  const reasoningVisibility: string = data.showReasoning ? 'visible' : 'off';

  const systemPrompt = buildSystemPrompt({
    mode,
    userInstructions: data.systemPrompt,
    safetyGuardrails: options.safetyGuardrails ?? '',
    toolsSummary,
    skillsSummary,
    workspacePath,
    bootstrapFiles: null,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    timezone,
    nowIso,
    reasoningVisibility,
    runtimeMeta: {
      host: 'simple-agent-manager',
      os: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      model: data.modelId,
      thinkingLevel: data.thinkingLevel,
    },
  });

  return {
    id: agentNodeId,
    version: 2,
    name: data.name,
    description: data.description,
    tags: data.tags,
    provider: providerConfig,
    modelId: data.modelId,
    thinkingLevel: data.thinkingLevel,
    systemPrompt,
    modelCapabilities: data.modelCapabilities ?? {},
    memory,
    tools: toolsConfig,
    contextEngine,
    connectors,
    agentComm,
    storage,
    vectorDatabases,
    crons,
    mcps,
    subAgents: [],
    // Exec tool cwd overrides agent-level workingDirectory when set
    workspacePath:
      (toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.exec?.cwd)
        ? toolsNode.data.toolSettings.exec.cwd
        : (data.workingDirectory || null),
    sandboxWorkdir: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.exec?.sandboxWorkdir ?? false
      : false,
    xaiApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.codeExecution?.apiKey
      ? toolsNode.data.toolSettings.codeExecution.apiKey
      : undefined,
    xaiModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.codeExecution?.model
      ? toolsNode.data.toolSettings.codeExecution.model
      : undefined,
    tavilyApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.webSearch?.tavilyApiKey
      ? toolsNode.data.toolSettings.webSearch.tavilyApiKey
      : undefined,
    openaiApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.image?.openaiApiKey
      ? toolsNode.data.toolSettings.image.openaiApiKey
      : undefined,
    geminiApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.image?.geminiApiKey
      ? toolsNode.data.toolSettings.image.geminiApiKey
      : undefined,
    imageModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.image?.preferredModel
      ? toolsNode.data.toolSettings.image.preferredModel
      : undefined,
    canvaPortRangeStart: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.canva?.portRangeStart
      : undefined,
    canvaPortRangeEnd: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.canva?.portRangeEnd
      : undefined,
    browserUserDataDir: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.browser?.userDataDir
      ? toolsNode.data.toolSettings.browser.userDataDir
      : undefined,
    browserHeadless: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.headless
      : undefined,
    browserViewportWidth: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.viewportWidth
      : undefined,
    browserViewportHeight: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.viewportHeight
      : undefined,
    browserTimeoutMs: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.timeoutMs
      : undefined,
    browserAutoScreenshot: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.autoScreenshot
      : undefined,
    browserScreenshotFormat: (() => {
      if (toolsNode?.data.type !== 'tools') return undefined;
      const value = toolsNode.data.toolSettings?.browser?.screenshotFormat;
      return value === 'png' || value === 'jpeg' ? value : undefined;
    })(),
    browserScreenshotQuality: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.screenshotQuality
      : undefined,
    browserStealth: toolsNode?.data.type === 'tools'
      ? toolsNode.data.toolSettings?.browser?.stealth
      : undefined,
    browserLocale: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.browser?.locale
      ? toolsNode.data.toolSettings.browser.locale
      : undefined,
    browserTimezone: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.browser?.timezone
      ? toolsNode.data.toolSettings.browser.timezone
      : undefined,
    browserUserAgent: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.browser?.userAgent
      ? toolsNode.data.toolSettings.browser.userAgent
      : undefined,
    browserCdpEndpoint: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.browser?.cdpEndpoint
      ? toolsNode.data.toolSettings.browser.cdpEndpoint
      : undefined,
    ttsPreferredProvider: (() => {
      if (toolsNode?.data.type !== 'tools') return undefined;
      const value = toolsNode.data.toolSettings?.textToSpeech?.preferredProvider;
      return value && value.length > 0 ? value : undefined;
    })(),
    elevenLabsApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.elevenLabsApiKey
      ? toolsNode.data.toolSettings.textToSpeech.elevenLabsApiKey
      : undefined,
    elevenLabsDefaultVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.elevenLabsDefaultVoice
      ? toolsNode.data.toolSettings.textToSpeech.elevenLabsDefaultVoice
      : undefined,
    elevenLabsDefaultModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.elevenLabsDefaultModel
      ? toolsNode.data.toolSettings.textToSpeech.elevenLabsDefaultModel
      : undefined,
    openaiTtsVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.openaiVoice
      ? toolsNode.data.toolSettings.textToSpeech.openaiVoice
      : undefined,
    openaiTtsModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.openaiModel
      ? toolsNode.data.toolSettings.textToSpeech.openaiModel
      : undefined,
    geminiTtsVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.geminiVoice
      ? toolsNode.data.toolSettings.textToSpeech.geminiVoice
      : undefined,
    geminiTtsModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.geminiModel
      ? toolsNode.data.toolSettings.textToSpeech.geminiModel
      : undefined,
    microsoftTtsApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.microsoftApiKey
      ? toolsNode.data.toolSettings.textToSpeech.microsoftApiKey
      : undefined,
    microsoftTtsRegion: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.microsoftRegion
      ? toolsNode.data.toolSettings.textToSpeech.microsoftRegion
      : undefined,
    microsoftTtsVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.microsoftDefaultVoice
      ? toolsNode.data.toolSettings.textToSpeech.microsoftDefaultVoice
      : undefined,
    minimaxApiKey: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.minimaxApiKey
      ? toolsNode.data.toolSettings.textToSpeech.minimaxApiKey
      : undefined,
    minimaxGroupId: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.minimaxGroupId
      ? toolsNode.data.toolSettings.textToSpeech.minimaxGroupId
      : undefined,
    minimaxDefaultVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.minimaxDefaultVoice
      ? toolsNode.data.toolSettings.textToSpeech.minimaxDefaultVoice
      : undefined,
    minimaxDefaultModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.minimaxDefaultModel
      ? toolsNode.data.toolSettings.textToSpeech.minimaxDefaultModel
      : undefined,
    openrouterTtsVoice: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.openrouterVoice
      ? toolsNode.data.toolSettings.textToSpeech.openrouterVoice
      : undefined,
    openrouterTtsModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.textToSpeech?.openrouterModel
      ? toolsNode.data.toolSettings.textToSpeech.openrouterModel
      : undefined,
    musicPreferredProvider: (() => {
      if (toolsNode?.data.type !== 'tools') return undefined;
      const value = toolsNode.data.toolSettings?.musicGenerate?.preferredProvider;
      return value && value.length > 0 ? value : undefined;
    })(),
    geminiMusicModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.musicGenerate?.geminiModel
      ? toolsNode.data.toolSettings.musicGenerate.geminiModel
      : undefined,
    minimaxMusicModel: toolsNode?.data.type === 'tools' && toolsNode.data.toolSettings?.musicGenerate?.minimaxModel
      ? toolsNode.data.toolSettings.musicGenerate.minimaxModel
      : undefined,
    exportedAt: Date.now(),
    sourceGraphId: agentNodeId,
    runTimeoutMs: 172800000,
    showReasoning: data.showReasoning ?? false,
    verbose: data.verbose ?? false,
  };
}

export interface AgentGraphValidationError {
  code: 'missing_provider' | 'duplicate_provider' | 'empty_plugin_id';
  message: string;
}

export function validateAgentRuntimeGraph(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): AgentGraphValidationError[] {
  const errors: AgentGraphValidationError[] = [];

  const connectedEdges = edges.filter((e) => e.target === agentNodeId);
  const connectedNodes = connectedEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  const providerNodes = connectedNodes.filter((n) => n.data.type === 'provider');

  if (providerNodes.length === 0) {
    errors.push({
      code: 'missing_provider',
      message: 'Agent requires a connected Provider node to run.',
    });
  } else if (providerNodes.length > 1) {
    errors.push({
      code: 'duplicate_provider',
      message: 'Agent must have exactly one connected Provider node.',
    });
  } else if (
    providerNodes[0].data.type === 'provider' &&
    !(providerNodes[0].data.pluginId as string)
  ) {
    errors.push({
      code: 'empty_plugin_id',
      message: 'Provider node has no plugin selected.',
    });
  }

  return errors;
}
