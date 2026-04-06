type StartupLogger = Pick<typeof console, 'error'>;

interface StartupErrorHandlerOptions {
  port: number;
  logger?: StartupLogger;
  onFatal?: (exitCode: number) => void;
}

export function createStartupErrorHandler({
  port,
  logger = console,
  onFatal = (exitCode) => process.exit(exitCode),
}: StartupErrorHandlerOptions) {
  let handled = false;

  return (error: Error | NodeJS.ErrnoException) => {
    if (handled) {
      return;
    }
    handled = true;

    if (error.code === 'EADDRINUSE') {
      logger.error(`[Server] Port ${port} is already in use.`);
      logger.error('[Server] Stop the existing process or restart this backend with STORAGE_PORT=<open-port>.');
      onFatal(1);
      return;
    }

    logger.error('[Server] Failed to start backend.');
    logger.error(error);
    onFatal(1);
  };
}
