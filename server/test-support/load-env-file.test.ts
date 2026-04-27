import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from './load-env-file';

describe('loadEnvFile', () => {
  const tempDirs: string[] = [];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.QUOTED_VALUE;
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    process.env = originalEnv;
  });

  it('loads .env values into process.env without overriding existing variables', async () => {
    // Unset the process env variable that is passed externally in some environments
    const originalModel = process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_MODEL;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-env-test-'));
    tempDirs.push(dir);

    await fs.writeFile(
      path.join(dir, '.env'),
      [
        '# comment',
        'OPENROUTER_API_KEY=from-file',
        'OPENROUTER_MODEL="openai/gpt-4o-mini"',
        "QUOTED_VALUE='quoted text'",
      ].join('\n'),
      'utf-8',
    );

    process.env.OPENROUTER_API_KEY = 'from-process';

    const loaded = await loadEnvFile(path.join(dir, '.env'));

    expect(loaded).toEqual({
      OPENROUTER_API_KEY: 'from-file',
      OPENROUTER_MODEL: 'openai/gpt-4o-mini',
      QUOTED_VALUE: 'quoted text',
    });
    expect(process.env.OPENROUTER_API_KEY).toBe('from-process');
    expect(process.env.OPENROUTER_MODEL).toBe('openai/gpt-4o-mini');
    expect(process.env.QUOTED_VALUE).toBe('quoted text');

    // Restore the process env variable
    if (originalModel) {
      process.env.OPENROUTER_MODEL = originalModel;
    }
  });

  it('returns an empty object when the file does not exist', async () => {
    expect(await loadEnvFile(path.join(os.tmpdir(), 'missing-sam-env-file'))).toEqual({});
  });
});
