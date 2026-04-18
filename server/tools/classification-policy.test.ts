import { describe, expect, it } from 'vitest';
import {
  classifyTool,
  groupByClassification,
  buildToolClassificationMatrix,
} from './classification-policy';

describe('classifyTool', () => {
  it('reads classification from registered modules', () => {
    expect(classifyTool('calculator')).toBe('read-only');
    expect(classifyTool('write_file')).toBe('state-mutating');
    expect(classifyTool('exec')).toBe('destructive');
  });

  it('resolves aliases before lookup', () => {
    // `bash` is an alias for `exec` — inherits destructive classification.
    expect(classifyTool('bash')).toBe('destructive');
  });

  it('falls back to the static map for tools not in the registry', () => {
    expect(classifyTool('memory_save')).toBe('state-mutating');
    expect(classifyTool('memory_search')).toBe('read-only');
    expect(classifyTool('sessions_list')).toBe('read-only');
    expect(classifyTool('send_message')).toBe('state-mutating');
  });

  it('defaults unknown tool names to state-mutating (conservative)', () => {
    expect(classifyTool('totally_made_up_tool')).toBe('state-mutating');
  });
});

describe('groupByClassification', () => {
  it('buckets tools into the three groups sorted alphabetically', () => {
    const groups = groupByClassification([
      'write_file',
      'calculator',
      'exec',
      'web_search',
      'apply_patch',
      'read_file',
    ]);
    expect(groups).toEqual({
      readOnly: ['calculator', 'read_file', 'web_search'],
      stateMutating: ['write_file'],
      destructive: ['apply_patch', 'exec'],
    });
  });

  it('drops ask_user and confirm_action from the matrix', () => {
    const groups = groupByClassification([
      'ask_user',
      'confirm_action',
      'calculator',
    ]);
    expect(groups).toEqual({
      readOnly: ['calculator'],
      stateMutating: [],
      destructive: [],
    });
  });

  it('deduplicates aliased names to their canonical form', () => {
    const groups = groupByClassification(['bash', 'exec']);
    expect(groups.destructive).toEqual(['exec']);
  });
});

describe('buildToolClassificationMatrix', () => {
  it('returns null when no non-HITL tools are enabled', () => {
    expect(buildToolClassificationMatrix([])).toBeNull();
    expect(buildToolClassificationMatrix(['ask_user', 'confirm_action'])).toBeNull();
  });

  it('renders only the groups that have tools', () => {
    const out = buildToolClassificationMatrix(['calculator', 'read_file'])!;
    expect(out).toContain('Read-only');
    expect(out).toContain('`calculator`');
    expect(out).toContain('`read_file`');
    expect(out).not.toContain('State-mutating');
    expect(out).not.toContain('Destructive');
  });

  it('renders all three groups when every classification is represented', () => {
    const out = buildToolClassificationMatrix([
      'calculator',
      'write_file',
      'exec',
    ])!;
    expect(out).toContain('Read-only');
    expect(out).toContain('State-mutating');
    expect(out).toContain('Destructive');
    expect(out).toContain('`calculator`');
    expect(out).toContain('`write_file`');
    expect(out).toContain('`exec`');
  });

  it('starts with the matrix header', () => {
    const out = buildToolClassificationMatrix(['calculator'])!;
    expect(out.startsWith('## Tool confirmation matrix')).toBe(true);
  });
});
