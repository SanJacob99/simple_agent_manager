import { Agent, type AgentEvent, type AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentConfig } from './agent-config';
import { MemoryEngine } from './memory-engine';
import { ContextEngine } from './context-engine';
import { resolveToolNames, createAgentTools } from './tool-factory';
import { resolveRuntimeModel } from './model-resolver';
import { useModelCatalogStore } from '../store/model-catalog-store';

export type RuntimeEvent =
  | AgentEvent
  | { type: 'runtime_ready'; config: AgentConfig }
  | { type: 'runtime_error'; error: string }
  | { type: 'memory_compaction'; summary: string };

export type RuntimeEventListener = (event: RuntimeEvent) => void;

/**
 * AgentRuntime wraps pi-agent-core Agent with memory, context engine, and tools.
 * Fully decoupled from React -- can run headless.
 */
export class AgentRuntime {
  private agent: Agent;
  private config: AgentConfig;
  private listeners = new Set<RuntimeEventListener>();
  private memoryEngine: MemoryEngine | null = null;
  private contextEngine: ContextEngine | null = null;
  private unsubscribeAgent: (() => void) | null = null;

  constructor(
    config: AgentConfig,
    getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  ) {
    this.config = config;

    // Build memory engine
    if (config.memory) {
      this.memoryEngine = new MemoryEngine(config.memory);
    }

    // Build context engine
    if (config.contextEngine) {
      this.contextEngine = new ContextEngine(config.contextEngine);
    }

    // Build tools
    const memoryTools = this.memoryEngine?.createMemoryTools() || [];
    const toolNames = config.tools
      ? resolveToolNames(config.tools)
      : [];
    const tools = createAgentTools(toolNames, memoryTools as AgentTool<TSchema>[]);

    // Build system prompt with additions
    let systemPrompt = config.systemPrompt;
    if (this.contextEngine) {
      const addition = this.contextEngine.getSystemPromptAddition();
      if (addition) {
        systemPrompt += '\n\n' + addition;
      }
    }

    const model = resolveRuntimeModel({
      provider: config.provider,
      modelId: config.modelId,
      modelCapabilities: config.modelCapabilities,
      getDiscoveredModel: (provider, modelId) =>
        useModelCatalogStore.getState().getModelMetadata(provider, modelId),
    });

    // Create Agent
    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: config.thinkingLevel as any,
        tools,
        messages: [],
      },
      transformContext: this.contextEngine?.buildTransformContext(),
      getApiKey,
      toolExecution: 'parallel',
    });

    // Forward agent events to runtime listeners
    this.unsubscribeAgent = this.agent.subscribe((event: AgentEvent) => {
      this.emit(event);
    });

    this.emit({ type: 'runtime_ready', config });
  }

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the runtime
      }
    }
  }

  subscribe(fn: RuntimeEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async prompt(text: string): Promise<void> {
    try {
      await this.agent.prompt(text);

      // After-turn bookkeeping
      if (this.contextEngine) {
        await this.contextEngine.afterTurn(this.agent.state.messages);
      }
    } catch (error) {
      this.emit({
        type: 'runtime_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  abort() {
    this.agent.abort();
  }

  destroy() {
    this.abort();
    this.unsubscribeAgent?.();
    this.listeners.clear();
  }

  get state() {
    return this.agent.state;
  }
}
