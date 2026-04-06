import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/agents/openrouter.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
