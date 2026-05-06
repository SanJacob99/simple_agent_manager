import { afterEach, describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG } from './catalog';

describe('CONNECTOR_CATALOG', () => {
  it('contains the github entry with the verified stdio invocation', () => {
    const github = CONNECTOR_CATALOG.github;
    expect(github).toBeDefined();
    expect(github.id).toBe('github');
    expect(github.label).toBe('GitHub');
    expect(github.mcp.transport).toBe('stdio');
    expect(github.mcp.command).toBe('npx');
    expect(github.mcp.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(github.toolPrefix).toBe('github_');
  });

  it('declares a tokenEnvVar variable with sensible defaults', () => {
    const github = CONNECTOR_CATALOG.github;
    expect(github.variables).toHaveLength(1);
    const tokenVar = github.variables[0];
    expect(tokenVar.key).toBe('tokenEnvVar');
    expect(tokenVar.default).toBe('GITHUB_PERSONAL_ACCESS_TOKEN');
  });
});

describe('CONNECTOR_CATALOG.github.buildEnv', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the token env entry when the named env var is set', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' };
    const env = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' });
    expect(env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' });
  });

  it('returns an empty env when the named env var is not set', () => {
    const env = { ...ORIGINAL_ENV };
    delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete env.MISSING_TOKEN_VAR;
    process.env = env;
    const result = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: 'MISSING_TOKEN_VAR' });
    expect(result).toEqual({});
  });

  it('falls back to GITHUB_PERSONAL_ACCESS_TOKEN when tokenEnvVar value is empty', () => {
    process.env = { ...ORIGINAL_ENV, GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_default' };
    const result = CONNECTOR_CATALOG.github.buildEnv({ tokenEnvVar: '' });
    expect(result).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_default' });
  });
});
