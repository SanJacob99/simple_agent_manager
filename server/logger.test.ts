import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs before importing logger so no real file is created
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
    })),
  };
});

// Dynamic import so mock is applied first
const { log, logError, logConsoleAndFile } = await import('./logger');

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log() does not call console.error or console.log', () => {
    log('TEST', 'hello');
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logError() calls console.error with category and message', () => {
    logError('ws', 'Socket error: connection reset');
    expect(console.error).toHaveBeenCalledWith('[ws]', 'Socket error: connection reset');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logConsoleAndFile() calls console.log with category and message', () => {
    logConsoleAndFile('ws', 'Client connected');
    expect(console.log).toHaveBeenCalledWith('[ws]', 'Client connected');
    expect(console.error).not.toHaveBeenCalled();
  });
});
