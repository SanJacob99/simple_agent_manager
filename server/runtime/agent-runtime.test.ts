import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from './agent-runtime';
import { log } from '../logger';
import type { AgentConfig } from '../../shared/agent-config';
import {
  DEFAULT_CONFIRMATION_POLICY,
  DEFAULT_SAFETY_SETTINGS,
} from '../storage/settings-file-store';
import { initializeToolRegistry } from '../tools/tool-registry';

beforeAll(async () => {
  await initializeToolRegistry();
});

vi.mock('../logger');

const promptMock = vi.fn();
const subscribeMock = vi.fn(() => vi.fn());
const abortMock = vi.fn();

// Captures the onPayload callback passed to Agent constructor so tests can invoke it directly.
let capturedOnPayload: ((payload: any) => void) | undefined;
// Captures the system prompt passed to Agent's initialState, so tests can
// assert on the resolved prompt (policy substitutions, workspace section,
// etc).
let capturedSystemPrompt: string | undefined;

vi.mock('@mariozechner/pi-agent-core', () => {
  class MockAgent {
    state: { systemPrompt: string; model: { id: string }; messages: unknown[] };

    prompt = promptMock;
    subscribe = subscribeMock;
    abort = abortMock;

    constructor(options: any) {
      if (options?.onPayload) {
        capturedOnPayload = options.onPayload;
      }
      const systemPrompt = options?.initialState?.systemPrompt ?? 'Test prompt';
      capturedSystemPrompt = systemPrompt;
      this.state = {
        systemPrompt,
        model: { id: 'gpt-4' },
        messages: [],
      };
    }
  }

  return { Agent: MockAgent };
});

vi.mock('./model-resolver', () => ({
  resolveRuntimeModel: vi.fn(() => ({ id: 'gpt-4' })),
}));

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Test prompt', tokenEstimate: 2 }],
      assembled: 'Test prompt',
      userInstructions: 'Test prompt',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

describe('AgentRuntime', () => {
  beforeEach(() => {
    promptMock.mockReset();
    subscribeMock.mockClear();
    abortMock.mockClear();
    capturedOnPayload = undefined;
    vi.mocked(log).mockClear();
  });

  it('rejects prompt when the underlying agent prompt throws', async () => {
    promptMock.mockRejectedValueOnce(new Error('stream failed'));

    const runtime = new AgentRuntime(makeConfig(), () => 'sk-test');

    await expect(runtime.prompt('Hello')).rejects.toThrow('stream failed');
  });

  it('does not block prompt progress while debug body logging reads the response clone', async () => {
    let resolveBodyText!: (value: string) => void;
    const bodyTextPromise = new Promise<string>((resolve) => {
      resolveBodyText = resolve;
    });

    const cloneText = vi.fn(() => bodyTextPromise);
    const originalFetch = vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      clone: () => ({ text: cloneText }),
    }));

    const previousFetch = globalThis.fetch;
    globalThis.fetch = originalFetch as typeof fetch;

    try {
      promptMock.mockImplementationOnce(async () => {
        await globalThis.fetch('https://example.test/stream');
      });

      const runtime = new AgentRuntime(makeConfig(), () => 'sk-test');

      let resolved = false;
      const promptPromise = runtime.prompt('Hello').then(() => {
        resolved = true;
      });

      await vi.waitFor(() => {
        expect(originalFetch).toHaveBeenCalledWith('https://example.test/stream');
        expect(cloneText).toHaveBeenCalledTimes(1);
        expect(resolved).toBe(true);
      });

      resolveBodyText('data: streamed chunk');
      await promptPromise;
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('summarizePayload behavior via onPayload', () => {
  beforeEach(() => {
    promptMock.mockReset();
    subscribeMock.mockClear();
    abortMock.mockClear();
    capturedOnPayload = undefined;
    vi.mocked(log).mockClear();
    // Construct a runtime so that MockAgent captures onPayload
    new AgentRuntime(makeConfig(), () => 'sk-test');
  });

  it('formats short string content correctly', () => {
    expect(capturedOnPayload).toBeDefined();
    const payload = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello world' }],
      tools: [{ name: 'tool1' }, { name: 'tool2' }, { name: 'tool3' }],
    };
    capturedOnPayload!(payload);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'pi-ai Request Payload',
      'model=claude-sonnet-4-6 | messages=1 | tools=3 | reasoning=(absent) | reasoning_effort=(absent) | keys=[model,messages,tools] | last_user=Hello world',
    );
  });

  it('truncates long string content at 200 chars with ellipsis', () => {
    expect(capturedOnPayload).toBeDefined();
    const longText = 'A'.repeat(250);
    const payload = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: longText }],
      tools: [],
    };
    capturedOnPayload!(payload);
    const [[, summary]] = vi.mocked(log).mock.calls;
    expect(summary).toMatch(/last_user=A{200}\.\.\.$/);
  });

  it('extracts text from array content with a text block', () => {
    expect(capturedOnPayload).toBeDefined();
    const payload = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', url: 'http://example.com/img.png' },
            { type: 'text', text: 'What is this?' },
          ],
        },
      ],
      tools: [{ name: 'search' }],
    };
    capturedOnPayload!(payload);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'pi-ai Request Payload',
      'model=gpt-4 | messages=1 | tools=1 | reasoning=(absent) | reasoning_effort=(absent) | keys=[model,messages,tools] | last_user=What is this?',
    );
  });

  it('produces empty last_user when array content has no text block', () => {
    expect(capturedOnPayload).toBeDefined();
    const payload = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', url: 'http://example.com/img.png' }],
        },
      ],
      tools: [],
    };
    capturedOnPayload!(payload);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'pi-ai Request Payload',
      'model=gpt-4 | messages=1 | tools=0 | reasoning=(absent) | reasoning_effort=(absent) | keys=[model,messages,tools] | last_user=',
    );
  });

  it('produces empty last_user when there is no user message', () => {
    expect(capturedOnPayload).toBeDefined();
    const payload = {
      model: 'gpt-4',
      messages: [{ role: 'assistant', content: 'Sure, here you go.' }],
      tools: [{ name: 'tool1' }],
    };
    capturedOnPayload!(payload);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'pi-ai Request Payload',
      'model=gpt-4 | messages=1 | tools=1 | reasoning=(absent) | reasoning_effort=(absent) | keys=[model,messages,tools] | last_user=',
    );
  });

  it('counts tools as 0 when tools key is absent from payload', () => {
    expect(capturedOnPayload).toBeDefined();
    const payload = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'No tools here' }],
      // tools deliberately omitted
    };
    capturedOnPayload!(payload);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'pi-ai Request Payload',
      'model=gpt-4 | messages=1 | tools=0 | reasoning=(absent) | reasoning_effort=(absent) | keys=[model,messages] | last_user=No tools here',
    );
  });
});

describe('confirmation policy classification substitution', () => {
  beforeEach(() => {
    promptMock.mockReset();
    subscribeMock.mockClear();
    abortMock.mockClear();
    capturedOnPayload = undefined;
    capturedSystemPrompt = undefined;
    vi.mocked(log).mockClear();
  });

  it('fills the three placeholders with the enabled tools grouped by class', () => {
    new AgentRuntime(
      makeConfig({
        tools: {
          profile: 'custom',
          enabledGroups: [],
          resolvedTools: [
            'calculator',
            'web_search',
            'write_file',
            'image_generate',
            'exec',
          ],
          plugins: [],
          skills: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        } as any,
      }),
      () => 'sk-test',
    );

    expect(capturedSystemPrompt).toBeDefined();
    const prompt = capturedSystemPrompt!;
    // ask_user + confirm_action get auto-added by the HITL safety
    // enforcement, which is what triggers the policy in the first place.
    expect(prompt).toContain('## Confirmation policy');

    // Read-only bucket: tools listed, ask_user / confirm_action omitted.
    expect(prompt).toMatch(/Read-only tools: [^\n]*`calculator`[^\n]*`web_search`/);
    expect(prompt).not.toMatch(/Read-only tools:[^\n]*`ask_user`/);
    expect(prompt).not.toMatch(/Read-only tools:[^\n]*`confirm_action`/);

    // State-mutating bucket.
    expect(prompt).toMatch(/State-mutating tools: [^\n]*`write_file`[^\n]*`image_generate`/);

    // Destructive bucket.
    expect(prompt).toMatch(/Destructive tools: [^\n]*`exec`/);

    // Ensure every placeholder was actually expanded.
    expect(prompt).not.toContain('{{READ_ONLY_TOOLS}}');
    expect(prompt).not.toContain('{{STATE_MUTATING_TOOLS}}');
    expect(prompt).not.toContain('{{DESTRUCTIVE_TOOLS}}');
  });

  it('renders "(none enabled)" for empty classes', () => {
    new AgentRuntime(
      makeConfig({
        tools: {
          profile: 'custom',
          enabledGroups: [],
          resolvedTools: ['write_file'],
          plugins: [],
          skills: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        } as any,
      }),
      () => 'sk-test',
    );

    expect(capturedSystemPrompt).toBeDefined();
    const prompt = capturedSystemPrompt!;
    expect(prompt).toMatch(/Read-only tools: \(none enabled\)/);
    expect(prompt).toMatch(/State-mutating tools: [^\n]*`write_file`/);
    expect(prompt).toMatch(/Destructive tools: \(none enabled\)/);
  });

  it('leaves a custom policy without placeholders untouched', () => {
    const customPolicy = '## My custom policy\n\nAlways confirm. No exceptions.';
    new AgentRuntime(
      makeConfig({
        tools: {
          profile: 'custom',
          enabledGroups: [],
          resolvedTools: ['calculator'],
          plugins: [],
          skills: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        } as any,
      }),
      () => 'sk-test',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...DEFAULT_SAFETY_SETTINGS,
        confirmationPolicy: customPolicy,
      },
    );

    expect(capturedSystemPrompt).toBeDefined();
    expect(capturedSystemPrompt).toContain(customPolicy);
    expect(capturedSystemPrompt).not.toContain('{{READ_ONLY_TOOLS}}');
  });

  it('does not append the policy when no HITL tool is enabled', () => {
    new AgentRuntime(
      makeConfig({
        tools: {
          profile: 'custom',
          enabledGroups: [],
          resolvedTools: ['calculator'],
          plugins: [],
          skills: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        } as any,
      }),
      () => 'sk-test',
      undefined,
      undefined,
      undefined,
      undefined,
      { allowDisableHitl: true, confirmationPolicy: DEFAULT_CONFIRMATION_POLICY },
    );

    expect(capturedSystemPrompt).toBeDefined();
    expect(capturedSystemPrompt).not.toContain('## Confirmation policy');
  });
});
