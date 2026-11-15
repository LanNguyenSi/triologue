/**
 * Unit tests for lib/shutdown.ts. No database, no real signals: the handler
 * is called directly with fake server/prisma/redis/logger/exit objects, so
 * this runs under plain `npx jest` without RUN_DB_TESTS.
 */
import {
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
};

function makeFakes(overrides: Partial<ShutdownResources> = {}): Fake {
  const events: string[] = [];
  const close = jest.fn((cb: (err?: Error) => void) => {
    events.push("close");
    setTimeout(() => cb(), 0);
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
    server: { close: close as unknown as ShutdownResources["server"]["close"] },
    prisma: {
      $disconnect: disconnectDb as unknown as ShutdownResources["prisma"]["$disconnect"],
    },
    redis: {
      disconnect:       disconnectRedis as unknown as ShutdownResources["redis"]["disconnect"],
    },
    logger,
    exit: exit as unknown as (code: number) => void,
    ...overrides,
  };
  return { resources, events, close, disconnectDb, disconnectRedis, exit };
}

describe("createShutdownHandler", () => {
  it("closes the server first, then disconnects, then exits 0", async () => {
    const f = makeFakes();
    const shutdown = createShutdownHandler(f.resources);
    await shutdown();
    expect(f.events).toEqual([
      "close",
      "prisma.$disconnect",
      "redis.disconnect",
      "exit(0)",
    ]);
    expect(f.resources.logger.error).not.toHaveBeenCalled();
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
      "prisma.$disconnect",
      "redis.disconnect",
      "exit(0)",
    ]);
    expect(f.resources.logger.warn).toHaveBeenCalled();
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
