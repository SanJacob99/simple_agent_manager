import { describe, it, expect } from 'vitest';
import type { SystemPromptMode, SystemPromptSection, ResolvedSystemPrompt } from './agent-config';
import { buildSystemPrompt } from './system-prompt-builder';
import type { SystemPromptBuilderInput } from './system-prompt-builder';

function makeInput(overrides: Partial<SystemPromptBuilderInput> = {}): SystemPromptBuilderInput {
  return {
    mode: 'auto',
    userInstructions: '',
    safetyGuardrails: '## Safety\nBe safe.',
    toolsSummary: null,
    skillsSummary: null,
    workspacePath: null,
    bootstrapFiles: null,
    bootstrapMaxChars: 20000,
    bootstrapTotalMaxChars: 150000,
    timezone: null,
    runtimeMeta: {
      host: 'simple-agent-manager',
      os: 'linux',
      model: 'claude-sonnet-4-20250514',
      thinkingLevel: 'off',
    },
    ...overrides,
  };
}

describe('shared types', () => {
  it('SystemPromptMode accepts the three valid modes', () => {
    const modes: SystemPromptMode[] = ['auto', 'append', 'manual'];
    expect(modes).toHaveLength(3);
  });

  it('ResolvedSystemPrompt has the expected shape', () => {
    const prompt: ResolvedSystemPrompt = {
      mode: 'auto',
      sections: [
        { key: 'safety', label: 'Safety', content: 'Be safe.', tokenEstimate: 2 },
      ],
      assembled: 'Be safe.',
      userInstructions: '',
    };
    expect(prompt.sections).toHaveLength(1);
    expect(prompt.assembled).toBe('Be safe.');
  });
});

describe('buildSystemPrompt', () => {
  describe('auto mode', () => {
    it('includes safety and runtime sections', () => {
      const result = buildSystemPrompt(makeInput());
      expect(result.mode).toBe('auto');
      expect(result.sections.find(s => s.key === 'safety')).toBeDefined();
      expect(result.sections.find(s => s.key === 'runtime')).toBeDefined();
      expect(result.assembled).toContain('Be safe.');
    });

    it('ignores userInstructions', () => {
      const result = buildSystemPrompt(makeInput({ userInstructions: 'Custom stuff' }));
      expect(result.assembled).not.toContain('Custom stuff');
      expect(result.sections.find(s => s.key === 'userInstructions')).toBeUndefined();
    });

    it('includes tooling section when toolsSummary is provided', () => {
      const result = buildSystemPrompt(makeInput({ toolsSummary: 'web_fetch, calculator' }));
      const section = result.sections.find(s => s.key === 'tooling');
      expect(section).toBeDefined();
      expect(section!.content).toContain('web_fetch');
    });

    it('skips tooling section when toolsSummary is null', () => {
      const result = buildSystemPrompt(makeInput({ toolsSummary: null }));
      expect(result.sections.find(s => s.key === 'tooling')).toBeUndefined();
    });

    it('includes skills section when skillsSummary is provided', () => {
      const result = buildSystemPrompt(makeInput({ skillsSummary: 'research, coding' }));
      const section = result.sections.find(s => s.key === 'skills');
      expect(section).toBeDefined();
      expect(section!.content).toContain('research');
    });

    it('includes workspace section with bootstrap files', () => {
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/home/user/project',
        bootstrapFiles: [
          { name: 'IDENTITY.md', content: 'I am a research agent.' },
        ],
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      expect(section).toBeDefined();
      expect(section!.content).toContain('/home/user/project');
      expect(section!.content).toContain('I am a research agent.');
    });

    it('includes time section when timezone is provided', () => {
      const result = buildSystemPrompt(makeInput({ timezone: 'America/New_York' }));
      const section = result.sections.find(s => s.key === 'time');
      expect(section).toBeDefined();
      expect(section!.content).toContain('America/New_York');
    });

    it('skips time section when timezone is null', () => {
      const result = buildSystemPrompt(makeInput({ timezone: null }));
      expect(result.sections.find(s => s.key === 'time')).toBeUndefined();
    });
  });

  describe('append mode', () => {
    it('includes all auto sections plus userInstructions at the end', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'append',
        userInstructions: 'Always be concise.',
      }));
      expect(result.mode).toBe('append');
      expect(result.sections.find(s => s.key === 'safety')).toBeDefined();
      const userSection = result.sections.find(s => s.key === 'userInstructions');
      expect(userSection).toBeDefined();
      expect(userSection!.content).toContain('Always be concise.');
      // userInstructions must be the last section
      expect(result.sections[result.sections.length - 1].key).toBe('userInstructions');
    });

    it('skips userInstructions section when instructions are empty', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'append',
        userInstructions: '',
      }));
      expect(result.sections.find(s => s.key === 'userInstructions')).toBeUndefined();
    });
  });

  describe('manual mode', () => {
    it('returns only the user instructions as a single section', () => {
      const result = buildSystemPrompt(makeInput({
        mode: 'manual',
        userInstructions: 'Full custom prompt.',
        safetyGuardrails: '## Safety\nBe safe.',
      }));
      expect(result.mode).toBe('manual');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].key).toBe('manual');
      expect(result.assembled).toBe('Full custom prompt.');
      expect(result.assembled).not.toContain('Be safe.');
    });
  });

  describe('bootstrap truncation', () => {
    it('truncates individual files to bootstrapMaxChars', () => {
      const longContent = 'x'.repeat(500);
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/project',
        bootstrapFiles: [{ name: 'BIG.md', content: longContent }],
        bootstrapMaxChars: 100,
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      expect(section!.content).toContain('[truncated]');
      expect(section!.content).not.toContain('x'.repeat(500));
    });

    it('caps total bootstrap content to bootstrapTotalMaxChars', () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        name: `FILE_${i}.md`,
        content: 'y'.repeat(200),
      }));
      const result = buildSystemPrompt(makeInput({
        workspacePath: '/project',
        bootstrapFiles: files,
        bootstrapMaxChars: 20000,
        bootstrapTotalMaxChars: 500,
      }));
      const section = result.sections.find(s => s.key === 'workspace');
      // Not all 10 files * 200 chars should be present
      const fileMatches = section!.content.match(/FILE_\d+\.md/g) || [];
      expect(fileMatches.length).toBeLessThan(10);
    });
  });

  describe('token estimates', () => {
    it('sets tokenEstimate on each section', () => {
      const result = buildSystemPrompt(makeInput());
      for (const section of result.sections) {
        expect(section.tokenEstimate).toBeGreaterThan(0);
      }
    });
  });

  describe('assembled output', () => {
    it('joins all section contents with double newlines', () => {
      const result = buildSystemPrompt(makeInput({
        toolsSummary: 'web_fetch',
      }));
      const parts = result.sections.map(s => s.content);
      expect(result.assembled).toBe(parts.join('\n\n'));
    });
  });

  it('preserves userInstructions in the output', () => {
    const result = buildSystemPrompt(makeInput({
      mode: 'append',
      userInstructions: 'My instructions',
    }));
    expect(result.userInstructions).toBe('My instructions');
  });

  describe('SAM-owned sections', () => {
    it('always emits the identity section in auto mode', () => {
      const result = buildSystemPrompt(makeInput());
      const identity = result.sections.find((s) => s.key === 'identity');
      expect(identity).toBeDefined();
      expect(identity!.content).toMatch(/Simple Agent Manager|SAM/);
    });

    it('always emits executionBias and safety + reasoning + runtime', () => {
      const result = buildSystemPrompt(makeInput());
      for (const key of ['executionBias', 'safety', 'reasoning', 'runtime']) {
        expect(
          result.sections.find((s) => s.key === key),
          `missing section ${key}`,
        ).toBeDefined();
      }
    });

    it('appends user-supplied safetyGuardrails to the default safety block', () => {
      const result = buildSystemPrompt(
        makeInput({ safetyGuardrails: '## Safety\nAlways cite sources.' }),
      );
      const safety = result.sections.find((s) => s.key === 'safety')!;
      // Default block is present...
      expect(safety.content).toMatch(/power-seeking/);
      // ...and the user addition is appended.
      expect(safety.content).toContain('Always cite sources.');
    });

    it('still emits safety (with default) when user safetyGuardrails is empty', () => {
      const result = buildSystemPrompt(makeInput({ safetyGuardrails: '' }));
      expect(result.sections.find((s) => s.key === 'safety')).toBeDefined();
    });

    it('includes tooling guidance + enabled tool list under the tooling section', () => {
      const result = buildSystemPrompt(makeInput({ toolsSummary: 'exec, read_file' }));
      const tooling = result.sections.find((s) => s.key === 'tooling')!;
      expect(tooling.content).toMatch(/source of truth|Structured tools/);
      expect(tooling.content).toContain('exec, read_file');
    });

    it('emits selfUpdate section only when enabled', () => {
      const off = buildSystemPrompt(makeInput());
      expect(off.sections.find((s) => s.key === 'selfUpdate')).toBeUndefined();

      const on = buildSystemPrompt(
        makeInput({
          selfUpdate: {
            enabled: true,
            protectedPaths: ['tools.exec.ask', 'tools.exec.security'],
          },
        }),
      );
      const section = on.sections.find((s) => s.key === 'selfUpdate')!;
      expect(section.content).toContain('config.schema.lookup');
      expect(section.content).toContain('config.patch');
      expect(section.content).toContain('tools.exec.ask');
    });

    it('emits sandbox section when sandbox metadata is provided', () => {
      const result = buildSystemPrompt(
        makeInput({
          sandbox: { mode: 'podman', sandboxed: true, elevatedExecAvailable: false, paths: ['/work'] },
        }),
      );
      const section = result.sections.find((s) => s.key === 'sandbox')!;
      expect(section.content).toContain('podman');
      expect(section.content).toContain('/work');
    });

    it('emits documentation section when docsPath is provided', () => {
      const result = buildSystemPrompt(makeInput({ docsPath: '/opt/sam/docs' }));
      const section = result.sections.find((s) => s.key === 'documentation')!;
      expect(section.content).toContain('/opt/sam/docs');
    });

    it('emits replyTags + heartbeats sections when configured', () => {
      const result = buildSystemPrompt(
        makeInput({
          replyTags: { supported: true, example: '<reply to="main">hi</reply>' },
          heartbeats: { enabled: true, prompt: 'PING', ack: 'PONG' },
        }),
      );
      const tags = result.sections.find((s) => s.key === 'replyTags')!;
      const hb = result.sections.find((s) => s.key === 'heartbeats')!;
      expect(tags.content).toContain('<reply to="main">');
      expect(hb.content).toContain('PING');
      expect(hb.content).toContain('PONG');
    });

    it('produces a system prompt materially larger than the skeleton', () => {
      // Regression: the old builder emitted ~100-500 tokens; the
      // SAM-authored prompt should be substantially larger even with
      // no skills or bootstrap files present.
      const result = buildSystemPrompt(makeInput({ toolsSummary: 'exec, read_file' }));
      expect(result.assembled.length).toBeGreaterThan(1500);
    });

    it('reasoning section exposes thinkingLevel + visibility', () => {
      const result = buildSystemPrompt(
        makeInput({
          reasoningVisibility: 'high',
          runtimeMeta: {
            host: 'sam',
            os: 'linux',
            model: 'm',
            thinkingLevel: 'medium',
          },
        }),
      );
      const section = result.sections.find((s) => s.key === 'reasoning')!;
      expect(section.content).toContain('high');
      expect(section.content).toContain('medium');
    });

    it('runtime line includes node + repo when supplied', () => {
      const result = buildSystemPrompt(
        makeInput({
          runtimeMeta: {
            host: 'sam',
            os: 'darwin',
            model: 'claude',
            thinkingLevel: 'off',
            nodeVersion: '22.1.0',
            repoRoot: '/home/user/project',
          },
        }),
      );
      const runtime = result.sections.find((s) => s.key === 'runtime')!;
      expect(runtime.content).toContain('node=22.1.0');
      expect(runtime.content).toContain('repo=/home/user/project');
    });
  });
});
