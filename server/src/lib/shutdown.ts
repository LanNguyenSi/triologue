/**
 * Graceful shutdown, extracted from index.ts so it is unit-testable without a
 * database or real signals.
 *
 * `docker stop` sends SIGTERM. With a handler registered only for SIGINT,
 * and `exec npm start` as the entrypoint, npm forwarded the SIGTERM and node
 * died at once, without draining requests or disconnecting Prisma and Redis,
 * and the container exited non-zero. The order here is deliberate: stop
 * accepting connections first (`server.close()`), and only then disconnect
 * Prisma and Redis, so in-flight requests never hit a closed database.
 * `server.close()` does not end upgraded websocket connections, so right
 * after it the socket.io clients are disconnected and idle keep-alive HTTP
 * connections are closed; otherwise every stop would wait for the timeout.
 * If `server.close()` has still not finished after `closeTimeoutMs` (default
 * 10 s) the shutdown proceeds anyway, which keeps the process inside the
 * compose `stop_grace_period`.
 */

export interface ShutdownResources {
  server: {
    close: (callback: (err?: Error) => void) => unknown;
    closeIdleConnections?: () => unknown;
  };
  io?: {
    disconnectSockets: (close?: boolean) => unknown;
    // engine.io server: closes every transport connection, including ones
    // that never joined a namespace or were rejected by an auth middleware
    // (disconnectSockets does not reach those). It does not close the http
    // server (socket.io 4.8: Server#close does that itself).
    engine?: { close: () => unknown };
  };
  prisma: {
    $disconnect: () => Promise<unknown>;
  };
  redis: {
    // node-redis throws "The client is closed" when disconnecting a client
    // that never connected, so a closed client is skipped.
    isOpen: boolean;
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
  const { server, io, prisma, redis, logger, exit } = resources;
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
      const settle = (): void => {
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const finish = (err?: Error): void => {
        if (done) {
          return;
        }
        if (err) {
          logger.warn("⚠️ server.close() reported an error, continuing shutdown:", err);
        } else {
          logger.info("✅ Server closed");
        }
        settle();
      };
      const timer = setTimeout(() => {
        if (done) {
          return;
        }
        logger.warn(
          `⏱️ server.close() did not finish within ${closeTimeoutMs}ms, continuing shutdown`,
        );
        settle();
      }, closeTimeoutMs);
      server.close(finish);
      // Upgraded websocket connections are not ended by server.close(); drop
      // them (and idle keep-alive sockets) so the close can complete.
      try {
        io?.disconnectSockets(true);
        io?.engine?.close();
        server.closeIdleConnections?.();
      } catch (error) {
        logger.warn("⚠️ Could not drop open connections, relying on the timeout:", error);
      }
    });

    try {
      await prisma.$disconnect();
      if (redis.isOpen) {
        await redis.disconnect();
      }
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
