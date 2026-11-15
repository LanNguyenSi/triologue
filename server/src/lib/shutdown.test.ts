/**
 * Unit tests for lib/shutdown.ts. No database, no real signals: the handler
 * is called directly with fake server/prisma/redis/logger/exit objects, so
 * this runs under plain `npx jest` without RUN_DB_TESTS.
 */
import http from "http";
import { AddressInfo } from "net";
import { Server as SocketIOServer } from "socket.io";
import WebSocket from "ws";
import {
  DEFAULT_CLOSE_TIMEOUT_MS,
  createShutdownHandler,
  registerShutdownSignals,
  ShutdownResources,
} from "./shutdown";

type Fake = {
  resources: ShutdownResources;
  events: string[];
  close: jest.Mock;
  disconnectDb: jest.Mock;
  disconnectRedis: jest.Mock;
  exit: jest.Mock;
  closeIdle: jest.Mock;
  disconnectSockets: jest.Mock;
};

function makeFakes(overrides: Partial<ShutdownResources> = {}): Fake {
  const events: string[] = [];
  // Completes asynchronously, like a real server.close().
  const close = jest.fn((cb: (err?: Error) => void) => {
    events.push("close");
    setTimeout(() => {
      events.push("close-done");
      cb();
    }, 0);
  });
  const closeIdle = jest.fn(() => {
    events.push("closeIdleConnections");
  });
  const disconnectSockets = jest.fn(() => {
    events.push("io.disconnectSockets");
  });
  const disconnectDb = jest.fn(async () => {
    events.push("prisma.$disconnect");
  });
  const disconnectRedis = jest.fn(async () => {
    events.push("redis.disconnect");
  });
  const exit = jest.fn((code: number) => {
    events.push(`exit(${code})`);
  });
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const resources: ShutdownResources = {
    server: {
      close: close as unknown as ShutdownResources["server"]["close"],
      closeIdleConnections: closeIdle,
    },
    io: { disconnectSockets },
    prisma: {
      $disconnect: disconnectDb as unknown as ShutdownResources["prisma"]["$disconnect"],
    },
    redis: {
      isOpen: true,
      disconnect: disconnectRedis as unknown as ShutdownResources["redis"]["disconnect"],
    },
    logger,
    exit: exit as unknown as (code: number) => void,
    ...overrides,
  };
  return {
    resources,
    events,
    close,
    disconnectDb,
    disconnectRedis,
    exit,
    closeIdle,
    disconnectSockets,
  };
}

describe("createShutdownHandler", () => {
  it("closes the server first, then disconnects, then exits 0", async () => {
    const f = makeFakes();
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    expect(f.events).toEqual([
      "close",
      "io.disconnectSockets",
      "closeIdleConnections",
      "close-done",
      "prisma.$disconnect",
      "redis.disconnect",
      "exit(0)",
    ]);
    expect(f.resources.logger.error).not.toHaveBeenCalled();
    expect(f.disconnectSockets).toHaveBeenCalledWith(true);
    expect(f.resources.logger.info).toHaveBeenCalledWith("✅ Server closed");
  });

  it("does not disconnect a redis client that never opened, and still exits 0", async () => {
    const f = makeFakes();
    f.disconnectRedis.mockRejectedValue(new Error("The client is closed"));
    const shutdown = createShutdownHandler({
      ...f.resources,
      redis: { isOpen: false, disconnect: f.disconnectRedis },
    });
    await shutdown();
    expect(f.disconnectRedis).not.toHaveBeenCalled();
    expect(f.disconnectDb).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledWith(0);
    expect(f.exit).not.toHaveBeenCalledWith(1);
  });

  it("works without io and without closeIdleConnections", async () => {
    const f = makeFakes();
    const shutdown = createShutdownHandler({
      ...f.resources,
      io: undefined,
      server: { close: f.resources.server.close },
    });
    await shutdown();
    expect(f.exit).toHaveBeenCalledWith(0);
  });

  it("still shuts down when dropping connections throws", async () => {
    const f = makeFakes();
    f.disconnectSockets.mockImplementation(() => {
      throw new Error("boom");
    });
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    expect(f.resources.logger.warn).toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledWith(0);
  });

  it("runs only once, even if called again", async () => {
    const f = makeFakes();
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    await shutdown();
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.disconnectDb).toHaveBeenCalledTimes(1);
    expect(f.disconnectRedis).toHaveBeenCalledTimes(1);
    expect(f.exit).toHaveBeenCalledTimes(1);
  });

  it("proceeds with disconnects and exit 0 when server.close never calls back", async () => {
    const f = makeFakes();
    f.close.mockImplementation(() => {
      f.events.push("close");
      // deliberately never invokes the callback
    });
    const shutdown = createShutdownHandler({ ...f.resources, closeTimeoutMs: 10 });
    await shutdown();
    expect(f.events).toEqual([
      "close",
      "io.disconnectSockets",
      "closeIdleConnections",
      "prisma.$disconnect",
      "redis.disconnect",
      "exit(0)",
    ]);
    expect(f.resources.logger.warn).toHaveBeenCalled();
    expect(f.resources.logger.info).not.toHaveBeenCalledWith("✅ Server closed");
  });

  describe("default close timeout (no closeTimeoutMs override)", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("is 10000 ms: no exit at 9999 ms, exit after 10000 ms", async () => {
      expect(DEFAULT_CLOSE_TIMEOUT_MS).toBe(10000);
      const f = makeFakes();
      f.close.mockImplementation(() => {
        // never calls back
      });
      const shutdown = createShutdownHandler(f.resources);
      const done = shutdown();
      await jest.advanceTimersByTimeAsync(9999);
      expect(f.exit).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await done;
      expect(f.exit).toHaveBeenCalledWith(0);
    });
  });

  it("logs and exits 1 when prisma.$disconnect fails", async () => {
    const f = makeFakes();
    f.disconnectDb.mockRejectedValue(new Error("db down"));
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    expect(f.resources.logger.error).toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledWith(1);
    expect(f.exit).not.toHaveBeenCalledWith(0);
  });

  it("logs and exits 1 when redis.disconnect fails", async () => {
    const f = makeFakes();
    f.disconnectRedis.mockRejectedValue(new Error("redis down"));
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    expect(f.resources.logger.error).toHaveBeenCalled();
    expect(f.exit).toHaveBeenCalledWith(1);
    expect(f.exit).not.toHaveBeenCalledWith(0);
  });
});

describe("registerShutdownSignals", () => {
  it("registers the handler for both SIGTERM and SIGINT", () => {
    const handler = jest.fn();
    const listeners: Record<string, () => void> = {};
    const emitter = {
      on: (signal: string, listener: () => void) => {
        listeners[signal] = listener;
      },
    };
    registerShutdownSignals(emitter, handler);
    expect(Object.keys(listeners).sort()).toEqual(["SIGINT", "SIGTERM"]);
    listeners.SIGTERM();
    listeners.SIGINT();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("shutdown against a real http + socket.io server", () => {
  it("finishes well under the close timeout with a connected websocket client", async () => {
    const httpServer = http.createServer();
    const io = new SocketIOServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address() as AddressInfo;

    const client = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    await new Promise<void>((resolve, reject) => {
      client.on("message", (data) => {
        const text = data.toString();
        // Engine.io open packet "0{...}", then join the default namespace.
        if (text.startsWith("0")) client.send("40");
        if (text.startsWith("40")) resolve();
      });
      client.on("error", reject);
    });
    const clientClosed = new Promise<void>((resolve) => client.on("close", () => resolve()));

    const exit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const shutdown = createShutdownHandler({
      server: httpServer,
      io,
      prisma: { $disconnect: async () => undefined },
      redis: { isOpen: false, disconnect: async () => undefined },
      logger,
      exit,
      closeTimeoutMs: 5000,
    });
    const started = Date.now();
    await shutdown();
    await clientClosed;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
