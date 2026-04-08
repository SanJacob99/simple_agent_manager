import { describe, expect, it, vi } from 'vitest';
import { createStartupErrorHandler } from './startup';

function makePortInUseError(port: number) {
  const error = new Error(
    `listen EADDRINUSE: address already in use :::${port}`,
  ) as NodeJS.ErrnoException & { port: number; address: string };
  error.code = 'EADDRINUSE';
  error.port = port;
  error.address = '::';
  error.syscall = 'listen';
  return error;
}

describe('startup error handler', () => {
  it('prints actionable guidance when the configured port is already in use', () => {
    const logger = { error: vi.fn() };
    const onFatal = vi.fn();
    const handleError = createStartupErrorHandler({ port: 3210, logger, onFatal });

    handleError(makePortInUseError(3210));

    expect(logger.error).toHaveBeenCalledWith('[Server] Port 3210 is already in use.');
    expect(logger.error).toHaveBeenCalledWith(
      '[Server] Stop the existing process or restart this backend with STORAGE_PORT=<open-port>.',
    );
    expect(onFatal).toHaveBeenCalledWith(1);
  });

  it('only handles the first startup error even if multiple listeners report it', () => {
    const logger = { error: vi.fn() };
    const onFatal = vi.fn();
    const handleError = createStartupErrorHandler({ port: 3210, logger, onFatal });
    const error = makePortInUseError(3210);

    handleError(error);
    handleError(error);

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(onFatal).toHaveBeenCalledTimes(1);
  });
});
