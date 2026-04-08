import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Stub global fetch so relative-URL calls from the settings store don't crash in jsdom
if (typeof globalThis.fetch === 'undefined' || !('__test_stubbed' in globalThis)) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ) as typeof globalThis.fetch;
  (globalThis as Record<string, unknown>).__test_stubbed = true;
}

afterEach(() => {
  cleanup();
});
