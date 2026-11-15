/**
 * Graceful shutdown, extracted from index.ts so it is unit-testable without a
 * database or real signals.
 *
 * `docker stop` sends SIGTERM, so a handler registered only for SIGINT lets
 * the container die hard at the end of the grace period. The order here is
 * deliberate: stop accepting connections first (`server.close()`), and only
 * then disconnect Prisma and Redis, so in-flight requests never hit a closed
 * database. `server.close()` waits for open connections to drain; if it has
 * not finished after `closeTimeoutMs` (default 10 s) the shutdown proceeds
 * anyway, which keeps the process inside the compose `stop_grace_period`.
 */

export interface ShutdownResources {
  server: {
    close: (callback: (err?: Error) => void) => unknown;
  };
  prisma: {
    $disconnect: () => Promise<unknown>;
  };
  redis: {
    disconnect: () => Promise<unknown>;
  };
  logger: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  exit: (code: number) => void;
  closeTimeoutMs?: number;
}

export const DEFAULT_CLOSE_TIMEOUT_MS = 10000;

// Returns the shutdown handler. It runs once: further invocations (both
// signals arriving, or a repeated `docker stop`) are no-ops.
export function createShutdownHandler(
  resources: ShutdownResources,
): () => Promise<void> {
  const { server, prisma, redis, logger, exit } = resources;
  const closeTimeoutMs = resources.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  let started = false;

  return async function shutdown(): Promise<void> {
    if (started) {
      return;
    }
    started = true;

    logger.info("🔄 Shutting down gracefully...");

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (err?: Error): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (err) {
          logger.warn("⚠️ server.close() reported an error, continuing shutdown:", err);
        } else {
          logger.info("✅ Server closed");
        }
        resolve();
      };
      const timer = setTimeout(() => {
        logger.warn(
          `⏱️ server.close() did not finish within ${closeTimeoutMs}ms, continuing shutdown`,
        );
        finish();
      }, closeTimeoutMs);
      server.close(finish);
    });

    try {
      await prisma.$disconnect();
      await redis.disconnect();
    } catch (error) {
      logger.error("❌ Error during shutdown:", error);
      exit(1);
      return;
    }
    exit(0);
  };
}

export interface SignalRegistrar {
  on(signal: string, listener: () => void): unknown;
}

// Registers the handler for both signals: SIGTERM (what `docker stop` sends)
// and SIGINT (Ctrl-C). The handler itself is once-guarded, so a process-like
// object that fires both still shuts down once.
export function registerShutdownSignals(
  emitter: SignalRegistrar,
  handler: () => void,
): void {
  emitter.on("SIGTERM", handler);
  emitter.on("SIGINT", handler);
}
