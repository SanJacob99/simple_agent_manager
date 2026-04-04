import { describe, it, expect } from 'vitest';
import type { SystemPromptMode, SystemPromptSection, ResolvedSystemPrompt } from './agent-config';

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
