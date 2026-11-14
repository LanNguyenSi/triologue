/**
 * Security tests for src/services/socketService.ts — HIGH gap coverage
 *
 * Guards tested in socketHandler:
 *   1. io.use auth middleware accepts a valid JWT token.
 *   2. io.use auth middleware rejects a missing token (error with descriptive message).
 *   3. io.use auth middleware rejects an invalid/malformed JWT token.
 *   4. BYOA agent tokens (byoa_ prefix) are NOT accepted by the socket auth
 *      (JWT-only path — current behavior, not changed here).
 *   5. On connection, only pre-authorized rooms are joined.
 *   6. message:send re-checks room membership before creating a message.
 *   7. room:join checks membership before socket.join().
 *   8. typing:start / typing:stop only write and broadcast for a
 *      participant of a plain (non-empty, non-"user:") room id.
 *   9. reaction:add loads the message first, requires membership of its
 *      room, and accepts only a short non-empty emoji string.
 *
 * Mutation-check intent:
 *   - Remove the token presence check in io.use → missing-token test fails
 *     (next would be called without error).
 *   - Remove the jwt.verify call → invalid-token test fails.
 *   - Remove the `!participation` guard in message:send → non-member can
 *     emit messages (no error emitted back to socket).
 *   - Make isRoomParticipant always return true → the typing and reaction
 *     non-participant tests fail.
 *   - Remove the `user:` refusal in isRoomParticipant → the `user:` typing
 *     tests fail.
 *   - Remove the emoji length bound in reaction:add → the too-long-emoji
 *     test fails.
 *   - Drop the message lookup in reaction:add → the unknown-message test
 *     fails (the upsert runs before anything is known about the message).
 */

jest.mock('../lib/prisma', () => {
  const prismaMock: Record<string, unknown> = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    roomParticipant: { findMany: jest.fn(), findUnique: jest.fn() },
    agentToken: { findMany: jest.fn() },
    message: { create: jest.fn(), findUnique: jest.fn() },
    room: { update: jest.fn() },
    thread: { findUnique: jest.fn(), update: jest.fn() },
    typingStatus: { upsert: jest.fn(), updateMany: jest.fn() },
    messageReaction: { upsert: jest.fn() },
  };
  // The interactive transaction runs its callback against the same mock, so
  // the calls made inside it are visible on the model mocks above.
  // The interactive transaction hands its callback a separate client whose
  // message.create and thread.update forward to the model mocks above and
  // record that they went through it. A write made on the plain client inside
  // the callback is not part of the transaction in Prisma, and is not
  // recorded here either.
  const viaTransaction: Record<string, boolean> = {};
  prismaMock.__viaTransaction = viaTransaction;
  const models = prismaMock as {
    message: { create: (a: unknown) => unknown };
    thread: { update: (a: unknown) => unknown };
  };
  prismaMock.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      message: {
        create: (args: unknown) => {
          viaTransaction.messageCreate = true;
          return models.message.create(args);
        },
      },
      thread: {
        update: (args: unknown) => {
          viaTransaction.threadUpdate = true;
          return models.thread.update(args);
        },
      },
    }),
  );
  return { __esModule: true, default: prismaMock };
});

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/mentionLimiter', () => ({
  consumeMention: jest.fn().mockResolvedValue({ allowed: true, current: 0, limit: 100, needsWarning: false }),
}));

jest.mock('../services/inboxService', () => ({
  createMentionInboxItems: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/projectRoomPolicy', () => ({
  getLinkedProjectStatus: jest.fn().mockResolvedValue(null),
  isRoomWriteBlocked: jest.fn().mockReturnValue(false),
}));

jest.mock('../plugins/manager', () => ({
  pluginManager: {
    emit: jest.fn().mockResolvedValue(undefined),
    isPluginActive: jest.fn().mockReturnValue(false),
  },
}));

import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { socketHandler } from '../services/socketService';
import { consumeMention } from '../services/mentionLimiter';

// ── helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET!; // set in jest.setup.js

function makeValidJwt(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET);
}

const DB_USER = {
  id: 'user-1',
  username: 'testuser',
  displayName: 'Test User',
  userType: 'HUMAN',
  isActive: true,
  isAdmin: false,
};

/**
 * Build a minimal mock socket.io Server that captures use() and on()
 * callbacks.
 *
 * Both callback array element types are declared as returning
 * `Promise<void>` (not `void`) because socketService's real handlers are
 * async and every call site below does `await authMw(...)` /
 * `await getConnectionHandler()(...)` on the captured callback — these are
 * load-bearing awaits (the handler's DB/redis work must finish before the
 * test asserts). A `void`-typed callback signature made those awaits type-
 * check as "await has no effect on the type of this expression" (TS80007)
 * even though they matter at runtime; typing the return as Promise<void>
 * keeps the awaits meaningful to the type checker too.
 */
function buildMockIo() {
  const useCbs: ((socket: unknown, next: (err?: Error) => void) => Promise<void>)[] = [];
  const connectionCbs: ((socket: unknown) => Promise<void>)[] = [];
  const toEmit = jest.fn();

  const io = {
    use: jest.fn((cb: (socket: unknown, next: (err?: Error) => void) => Promise<void>) => {
      useCbs.push(cb);
    }),
    on: jest.fn((event: string, cb: (socket: unknown) => Promise<void>) => {
      if (event === 'connection') connectionCbs.push(cb);
    }),
    to: jest.fn(() => ({ emit: toEmit })),
    // The disconnect handler reads io.sockets.sockets.values() to check for
    // other live sockets from the same user. An empty Map is enough for
    // tests that only exercise a single socket (remainingSockets stays []).
    sockets: { sockets: new Map() },
  };

  return {
    io,
    getAuthMiddleware: () => useCbs[0],
    getConnectionHandler: () => connectionCbs[0],
    toEmit,
  };
}

/**
 * Build a minimal mock socket with configurable auth token.
 *
 * `eventHandlers` and `_trigger` are typed to return `Promise<void>` (not
 * `void`) for the same reason as buildMockIo() above: every `message:send` /
 * `room:join` / `disconnect` handler registered via socket.on() is async,
 * and `await socket._trigger(...)` at the call sites below is load-bearing —
 * it waits for the handler's DB/redis side effects before the test asserts.
 */
function buildMockSocket(opts: { token?: string; userId?: string } = {}) {
  const eventHandlers: Record<string, (...args: unknown[]) => Promise<void>> = {};
  const socket = {
    handshake: { auth: { token: opts.token } },
    userId: opts.userId,
    username: undefined as string | undefined,
    userType: undefined as string | undefined,
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((event: string, cb: (...args: unknown[]) => Promise<void>) => {
      eventHandlers[event] = cb;
    }),
    _trigger: (event: string, ...args: unknown[]) => eventHandlers[event]?.(...args),
  };
  return socket;
}

const mockRedis = {
  sAdd: jest.fn().mockResolvedValue(1),
  sRem: jest.fn().mockResolvedValue(1),
  setEx: jest.fn().mockResolvedValue('OK'),
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.user.update as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.agentToken.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.message.create as jest.Mock).mockResolvedValue({
    id: 'msg-1',
    content: 'hello',
    roomId: 'room-1',
    senderId: 'user-1',
    messageType: 'TEXT',
    sender: DB_USER,
    reactions: [],
    attachments: [],
  });
  (prisma.room.update as jest.Mock).mockResolvedValue({});
});

// ── io.use auth middleware ─────────────────────────────────────────────────

describe('socketHandler — io.use auth middleware', () => {
  it('accepts a valid JWT and attaches userId/username to the socket', async () => {
    const { io, getAuthMiddleware } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const authMw = getAuthMiddleware();
    const socket = buildMockSocket({ token: makeValidJwt('user-1') });
    const next = jest.fn();

    await authMw(socket, next);

    expect(next).toHaveBeenCalledWith(); // no error arg
    expect(socket.userId).toBe('user-1');
    expect(socket.username).toBe('testuser');
  });

  it('rejects a socket with no token (missing token)', async () => {
    // Mutation target: remove the `if (!token)` guard → next() is called
    // without an error and the socket proceeds without authentication.
    const { io, getAuthMiddleware } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const authMw = getAuthMiddleware();
    const socket = buildMockSocket({ token: undefined });
    const next = jest.fn();

    await authMw(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const error = next.mock.calls[0][0] as Error;
    expect(error.message).toMatch(/token required/i);
  });

  it('rejects a socket with an invalid JWT (malformed token)', async () => {
    // Mutation target: bypass jwt.verify → invalid token would be accepted.
    const { io, getAuthMiddleware } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const authMw = getAuthMiddleware();
    const socket = buildMockSocket({ token: 'not.a.valid.jwt' });
    const next = jest.fn();

    await authMw(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const error = next.mock.calls[0][0] as Error;
    expect(error.message).toMatch(/authentication failed/i);
  });

  it('rejects a byoa_ token (JWT-only socket auth — current behavior)', async () => {
    // Socket auth currently only accepts JWTs; byoa_ agent tokens are rejected
    // because they are not valid JWTs. This is intentional current behavior.
    // Do NOT add BYOA support here — it is not in scope.
    const { io, getAuthMiddleware } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const authMw = getAuthMiddleware();
    const socket = buildMockSocket({ token: 'byoa_some_agent_token_here' });
    const next = jest.fn();

    await authMw(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    // byoa_ tokens fail jwt.verify and hit the catch → "Authentication failed"
    expect((next.mock.calls[0][0] as Error).message).toMatch(/authentication failed/i);
  });

  it('rejects when the user is inactive', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...DB_USER, isActive: false });
    const { io, getAuthMiddleware } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const authMw = getAuthMiddleware();
    const socket = buildMockSocket({ token: makeValidJwt('user-1') });
    const next = jest.fn();

    await authMw(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0][0] as Error).message).toMatch(/inactive/i);
  });
});

// ── connection handler — room joins ───────────────────────────────────────

describe('socketHandler — connection: joins only pre-authorized rooms', () => {
  it('joins only rooms where the user has a participant record', async () => {
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([
      { userId: 'user-1', roomId: 'room-1', room: { id: 'room-1', name: 'General' } },
      { userId: 'user-1', roomId: 'room-2', room: { id: 'room-2', name: 'Dev' } },
    ]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';

    await getConnectionHandler()(socket);

    const joinedRooms = (socket.join as jest.Mock).mock.calls.map((c) => c[0]);
    expect(joinedRooms).toContain('room-1');
    expect(joinedRooms).toContain('room-2');
    // Also joins the user-specific room
    expect(joinedRooms).toContain('user:user-1');
  });
});

// ── message:send — membership re-check ───────────────────────────────────

describe('socketHandler — message:send: re-checks membership', () => {
  async function setupConnectedSocket() {
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';

    await getConnectionHandler()(socket);
    return socket;
  }

  it('emits an error to the socket when the user is NOT a member of the room', async () => {
    // Mutation target: remove the `!participation` → error-emit guard →
    // the socket emits no error and proceeds to create a message.
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const socket = await setupConnectedSocket();

    await socket._trigger('message:send', { content: 'hello', roomId: 'room-1' });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/not authorized/i) }),
    );
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('creates a message when the user IS a member of the room', async () => {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const socket = await setupConnectedSocket();

    await socket._trigger('message:send', { content: 'hello', roomId: 'room-1' });

    expect(prisma.message.create as jest.Mock).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/not authorized/i) }),
    );
  });
});

// ── message:send, thread replies ────────────────────────────────────────

describe('socketHandler, message:send: thread replies', () => {
  async function setupMember() {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const { io, getConnectionHandler, toEmit } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);
    return { socket, toEmit };
  }

  it('stores the reply and bumps messageCount and lastActivity in the same transaction', async () => {
    // Mutation targets: drop the thread.update call; change the increment
    // to 0; move the update out of the transaction callback (the
    // $transaction assertion fails).
    (prisma.thread.findUnique as jest.Mock).mockResolvedValue({ id: 'thread-1', roomId: 'room-1' });
    const viaTransaction = (prisma as unknown as { __viaTransaction: Record<string, boolean> }).__viaTransaction;
    for (const k of Object.keys(viaTransaction)) delete viaTransaction[k];
    (prisma.thread.update as jest.Mock).mockResolvedValue({});
    const { socket, toEmit } = await setupMember();

    await socket._trigger('message:send', { content: 'reply', roomId: 'room-1', threadId: 'thread-1' });

    expect(prisma.thread.findUnique as jest.Mock).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      select: { id: true, roomId: true },
    });
    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(1);
    expect(viaTransaction).toEqual({ messageCreate: true, threadUpdate: true });
    expect(prisma.message.create as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1', threadId: 'thread-1' }) }),
    );
    expect(prisma.thread.update as jest.Mock).toHaveBeenCalledTimes(1);
    expect(prisma.thread.update as jest.Mock).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      data: { messageCount: { increment: 1 }, lastActivity: expect.any(Date) },
    });
    expect(toEmit).toHaveBeenCalledWith('message:new', expect.anything());
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('refuses an unknown thread and writes nothing', async () => {
    (prisma.thread.findUnique as jest.Mock).mockResolvedValue(null);
    const { socket, toEmit } = await setupMember();

    await socket._trigger('message:send', { content: 'reply', roomId: 'room-1', threadId: 'thread-nope' });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/threadId must name a thread/i) }),
    );
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.thread.update as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.room.update as jest.Mock).not.toHaveBeenCalled();
    expect(toEmit).not.toHaveBeenCalledWith('message:new', expect.anything());
  });

  it('refuses a thread of another room and writes nothing', async () => {
    // Mutation target: drop the `thread.roomId !== data.roomId` comparison.
    (prisma.thread.findUnique as jest.Mock).mockResolvedValue({ id: 'thread-2', roomId: 'room-2' });
    const { socket } = await setupMember();

    await socket._trigger('message:send', { content: 'reply', roomId: 'room-1', threadId: 'thread-2' });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/threadId must name a thread/i) }),
    );
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.thread.update as jest.Mock).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty string', ''],
    ['a blank string', '   '],
    ['a number', 42],
    ['a string with a NUL character', 'thread\u0000x'],
    ['a string with a lone surrogate', 'thread\ud800x'],
  ])('refuses %s as threadId without a lookup', async (_label, threadId) => {
    const { socket } = await setupMember();

    await socket._trigger('message:send', { content: 'reply', roomId: 'room-1', threadId });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/threadId must name a thread/i) }),
    );
    expect(prisma.thread.findUnique as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('a refused threadId consumes no mention quota, even with a billable mention in the content', async () => {
    // Mutation target: move the thread check after the mention-quota block.
    (prisma.thread.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.agentToken.findMany as jest.Mock).mockResolvedValue([
      { mentionKey: 'helper', createdById: 'someone-else', quotaExempt: false },
    ]);
    const { socket } = await setupMember();

    await socket._trigger('message:send', {
      content: 'hey @helper please look',
      roomId: 'room-1',
      threadId: 'thread-nope',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/threadId must name a thread/i) }),
    );
    expect(consumeMention as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('the same mention in a valid thread reply does consume the quota (control)', async () => {
    (prisma.thread.findUnique as jest.Mock).mockResolvedValue({ id: 'thread-1', roomId: 'room-1' });
    (prisma.thread.update as jest.Mock).mockResolvedValue({});
    (prisma.agentToken.findMany as jest.Mock).mockResolvedValue([
      { mentionKey: 'helper', createdById: 'someone-else', quotaExempt: false },
    ]);
    const { socket } = await setupMember();

    await socket._trigger('message:send', {
      content: 'hey @helper please look',
      roomId: 'room-1',
      threadId: 'thread-1',
    });

    expect(consumeMention as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('checks membership before it looks the thread up', async () => {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);
    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);

    await socket._trigger('message:send', { content: 'reply', roomId: 'room-1', threadId: 'thread-1' });

    expect(prisma.thread.findUnique as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
  });

  it('a top-level message (no threadId, or null) touches no thread and opens no transaction', async () => {
    // Mutation target: run the thread branch for a missing threadId.
    const { socket } = await setupMember();

    await socket._trigger('message:send', { content: 'top', roomId: 'room-1' });
    await socket._trigger('message:send', { content: 'top', roomId: 'room-1', threadId: null });

    expect(prisma.message.create as jest.Mock).toHaveBeenCalledTimes(2);
    expect(prisma.thread.findUnique as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.thread.update as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.$transaction as jest.Mock).not.toHaveBeenCalled();
    for (const call of (prisma.message.create as jest.Mock).mock.calls) {
      expect(call[0].data.threadId).toBeUndefined();
    }
  });
});

// ── message:send, characters Postgres cannot store ─────────────────────────

// Postgres refuses a NUL in text and Prisma cannot serialise a lone surrogate,
// so a send whose content carries either is refused on the error channel with
// the reason, before any query, instead of reaching the insert and ending in
// the catch's generic "Failed to send message".
describe('socketHandler, message:send: content Postgres cannot store', () => {
  async function setupMember() {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const { io, getConnectionHandler, toEmit } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);
    (prisma.roomParticipant.findUnique as jest.Mock).mockClear();
    return { socket, toEmit };
  }

  it.each([
    ['a NUL character', 'hello\u0000world'],
    ['a lone surrogate', 'hello\ud800world'],
  ])('refuses content with %s without a query', async (_label, content) => {
    const { socket, toEmit } = await setupMember();

    await socket._trigger('message:send', { content, roomId: 'room-1' });

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        message: expect.stringMatching(/characters that cannot be stored/i),
      }),
    );
    expect(prisma.roomParticipant.findUnique as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
    expect(toEmit).not.toHaveBeenCalledWith('message:new', expect.anything());
  });

  it.each([
    ['a NUL character', 'room\u00001'],
    ['a lone surrogate', 'room\ud8001'],
  ])('refuses a roomId with %s without a query', async (_label, roomId) => {
    const { socket } = await setupMember();

    await socket._trigger('message:send', { content: 'hello', roomId });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Room id contains characters that cannot be stored',
    });
    expect(socket.emit).not.toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/^Message contains/) }),
    );
    expect(prisma.roomParticipant.findUnique as jest.Mock).not.toHaveBeenCalled();
  });

  it('stores content with a well-formed emoji (a surrogate pair)', async () => {
    const { socket } = await setupMember();

    await socket._trigger('message:send', { content: 'shipped \u{1F680} today', roomId: 'room-1' });

    expect(prisma.message.create as jest.Mock).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });
});

// ── room:join — membership check ──────────────────────────────────────────

describe('socketHandler — room:join: membership check', () => {
  async function setupConnectedSocket() {
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';

    await getConnectionHandler()(socket);
    return socket;
  }

  it('does NOT join the room when the user is not a participant', async () => {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const socket = await setupConnectedSocket();

    // Clear initial join calls from connection setup
    (socket.join as jest.Mock).mockClear();

    await socket._trigger('room:join', { roomId: 'restricted-room' });

    const joinedRooms = (socket.join as jest.Mock).mock.calls.map((c) => c[0]);
    expect(joinedRooms).not.toContain('restricted-room');
  });

  it('joins the room when the user has a participant record', async () => {
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'allowed-room',
    });
    const socket = await setupConnectedSocket();

    (socket.join as jest.Mock).mockClear();

    await socket._trigger('room:join', { roomId: 'allowed-room' });

    expect(socket.join).toHaveBeenCalledWith('allowed-room');
  });
});

// ── typing:start / typing:stop — membership gate ───────────────────────────
//
// TypingStatus.roomId has no foreign key, so an unguarded handler lets any
// client upsert typing rows for arbitrary room ids and broadcast
// typing:update into rooms it is not in, including a victim's `user:`
// personal room. The gate refuses silently (typing is best-effort): no
// write, no broadcast, no error event.
describe('socketHandler — typing:start / typing:stop: membership gate', () => {
  async function setupConnectedSocket() {
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';

    await getConnectionHandler()(socket);
    (prisma.roomParticipant.findUnique as jest.Mock).mockClear();
    (socket.to as jest.Mock).mockClear();
    return socket;
  }

  /** The `emit` fn of the n-th socket.to(roomId) call. */
  function emittedTo(socket: ReturnType<typeof buildMockSocket>, n = 0) {
    return (socket.to as jest.Mock).mock.results[n].value.emit as jest.Mock;
  }

  it.each(['typing:start', 'typing:stop'] as const)(
    '%s by a participant upserts the row and broadcasts to the room',
    async (event) => {
      (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
        userId: 'user-1',
        roomId: 'room-1',
      });
      (prisma.typingStatus.upsert as jest.Mock).mockResolvedValue({});
      const socket = await setupConnectedSocket();

      await socket._trigger(event, { roomId: 'room-1' });

      expect(prisma.roomParticipant.findUnique).toHaveBeenCalledWith({
        where: { userId_roomId: { userId: 'user-1', roomId: 'room-1' } },
      });
      expect(prisma.typingStatus.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = (prisma.typingStatus.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.where).toEqual({
        userId_roomId: { userId: 'user-1', roomId: 'room-1' },
      });
      const isTyping = event === 'typing:start';
      expect(upsertArg.create.isTyping).toBe(isTyping);
      expect(upsertArg.update.isTyping).toBe(isTyping);
      expect(socket.to).toHaveBeenCalledWith('room-1');
      expect(emittedTo(socket)).toHaveBeenCalledWith('typing:update', {
        username: 'testuser',
        userType: 'HUMAN',
        isTyping,
      });
    },
  );

  it.each(['typing:start', 'typing:stop'] as const)(
    '%s by a NON-participant writes and broadcasts nothing',
    async (event) => {
      (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
      const socket = await setupConnectedSocket();

      await socket._trigger(event, { roomId: 'room-1' });

      expect(prisma.typingStatus.upsert as jest.Mock).not.toHaveBeenCalled();
      expect(socket.to).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled(); // best-effort: no error event
    },
  );

  it.each(['typing:start', 'typing:stop'] as const)(
    '%s with a `user:` room id is refused before any query, even with a participant row',
    async (event) => {
      // The membership query is mocked to HIT here: the refusal must come
      // from the `user:` shape check, not from a missing row.
      (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
        userId: 'user-1',
        roomId: 'user:victim-2',
      });
      const socket = await setupConnectedSocket();

      await socket._trigger(event, { roomId: 'user:victim-2' });

      expect(prisma.roomParticipant.findUnique as jest.Mock).not.toHaveBeenCalled();
      expect(prisma.typingStatus.upsert as jest.Mock).not.toHaveBeenCalled();
      expect(socket.to).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a missing roomId', {}],
    ['an empty roomId', { roomId: '' }],
    ['a non-string roomId', { roomId: 42 }],
  ])('%s is refused before any query', async (_label, data) => {
    for (const event of ['typing:start', 'typing:stop'] as const) {
      (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
        userId: 'user-1',
        roomId: 'room-1',
      });
      const socket = await setupConnectedSocket();

      await socket._trigger(event, data);

      expect(prisma.roomParticipant.findUnique as jest.Mock).not.toHaveBeenCalled();
      expect(prisma.typingStatus.upsert as jest.Mock).not.toHaveBeenCalled();
      expect(socket.to).not.toHaveBeenCalled();
    }
  });
});

// ── reaction:add — message room membership + emoji bound ───────────────────
//
// Without the gate any client could upsert a reaction onto any message by id
// and broadcast reaction:added into that message's room. The message row is
// now loaded first; unknown message or non-participant writes nothing and
// answers with the file's generic error shape (message:send emits "error" to
// non-participants too), one indistinct message for every refused case.
describe('socketHandler — reaction:add: message room membership + emoji bound', () => {
  const VALID_EMOJI = '\u{1F44D}'; // 👍, 2 UTF-16 code units
  const REACTION_FAILURE = { message: 'Failed to add reaction' };

  async function setupMember() {
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler, toEmit } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);
    (prisma.roomParticipant.findUnique as jest.Mock).mockClear();
    return { socket, toEmit, io };
  }

  it('upserts and broadcasts to the message room for a participant with a valid emoji', async () => {
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({ roomId: 'room-1' });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    (prisma.messageReaction.upsert as jest.Mock).mockResolvedValue({ id: 'reaction-1' });
    const { socket, toEmit, io } = await setupMember();

    await socket._trigger('reaction:add', { messageId: 'msg-1', emoji: VALID_EMOJI });

    expect(prisma.message.findUnique).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      select: { roomId: true },
    });
    expect(prisma.roomParticipant.findUnique).toHaveBeenCalledWith({
      where: { userId_roomId: { userId: 'user-1', roomId: 'room-1' } },
    });
    expect(prisma.messageReaction.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.messageReaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId_userId_emoji: { messageId: 'msg-1', userId: 'user-1', emoji: VALID_EMOJI },
        },
      }),
    );
    expect(toEmit).toHaveBeenCalledWith('reaction:added', {
      messageId: 'msg-1',
      emoji: VALID_EMOJI,
      userId: 'user-1',
      reaction: { id: 'reaction-1' },
    });
    // The broadcast goes to the message's own room, nowhere else.
    expect(io.to).toHaveBeenCalledWith('room-1');
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('still accepts an emoji of exactly the 16-code-unit bound', async () => {
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({ roomId: 'room-1' });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    (prisma.messageReaction.upsert as jest.Mock).mockResolvedValue({ id: 'reaction-1' });
    const { socket } = await setupMember();

    await socket._trigger('reaction:add', { messageId: 'msg-1', emoji: VALID_EMOJI.repeat(8) });

    expect(prisma.messageReaction.upsert as jest.Mock).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('writes and broadcasts nothing for a NON-participant of the message room', async () => {
    // Mutation target: make isRoomParticipant always return true → the
    // upsert and the broadcast below would run.
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({ roomId: 'room-9' });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const { socket, toEmit } = await setupMember();

    await socket._trigger('reaction:add', { messageId: 'msg-1', emoji: VALID_EMOJI });

    expect(prisma.messageReaction.upsert as jest.Mock).not.toHaveBeenCalled();
    expect(toEmit).not.toHaveBeenCalledWith('reaction:added', expect.anything());
    expect(socket.emit).toHaveBeenCalledWith('error', REACTION_FAILURE);
  });

  it('writes and broadcasts nothing for an unknown messageId', async () => {
    // Mutation target: drop the message lookup / run the upsert first →
    // the upsert would run before anything is known about the message.
    (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);
    const { socket, toEmit } = await setupMember();

    await socket._trigger('reaction:add', { messageId: 'msg-nope', emoji: VALID_EMOJI });

    expect(prisma.roomParticipant.findUnique as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.messageReaction.upsert as jest.Mock).not.toHaveBeenCalled();
    expect(toEmit).not.toHaveBeenCalledWith('reaction:added', expect.anything());
    expect(socket.emit).toHaveBeenCalledWith('error', REACTION_FAILURE);
  });

  it.each([
    ['an empty string', ''],
    ['17 code units (one past the bound)', VALID_EMOJI.repeat(8) + 'x'],
    ['a 40-character string', 'a'.repeat(40)],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { emoji: VALID_EMOJI }],
  ])('writes and broadcasts nothing for %s as emoji', async (_label, emoji) => {
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({ roomId: 'room-1' });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const { socket, toEmit } = await setupMember();

    await socket._trigger('reaction:add', { messageId: 'msg-1', emoji });

    expect(prisma.messageReaction.upsert as jest.Mock).not.toHaveBeenCalled();
    expect(toEmit).not.toHaveBeenCalledWith('reaction:added', expect.anything());
    expect(socket.emit).toHaveBeenCalledWith('error', REACTION_FAILURE);
  });
});

// ── redis offline-queue call-site audit (agent-tasks 60efd603) ─────────────
//
// index.ts's shared redis client now sets `disableOfflineQueue: true` (see
// index-redis-offline-queue.test.ts for the client-option decision itself),
// so a Redis outage makes sAdd/setEx/sRem reject immediately instead of
// queuing. These tests pin that socketService's three call sites handle
// that rejection without it becoming an unhandled rejection, aborting
// unrelated cleanup, or producing an incorrect user-facing error.
describe('socketHandler — redis command rejection is handled at every call site', () => {
  it('connection: an sAdd rejection does not abort the rest of connection setup', async () => {
    // Mutation target: remove the try/catch around the sAdd call in
    // socketService.ts → this rejection propagates out of the async
    // connection handler and prisma.user.update (last-seen) below it is
    // never reached.
    (mockRedis.sAdd as jest.Mock).mockRejectedValueOnce(new Error('client offline'));
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';

    await expect(getConnectionHandler()(socket)).resolves.not.toThrow();

    expect(mockRedis.sAdd).toHaveBeenCalledWith('online_users', 'user-1');
    // The rest of connection setup still ran despite the redis failure.
    expect(prisma.user.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('message:send: a setEx rejection does not emit "Failed to send message" for an already-sent message', async () => {
    // Mutation target: revert the setEx call in socketService.ts back to a
    // bare `await` inside the handler's outer try/catch → this rejection is
    // caught by that outer catch and incorrectly reports the send as failed
    // even though the message was already created and broadcast.
    (mockRedis.setEx as jest.Mock).mockRejectedValueOnce(new Error('client offline'));
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });

    const { io, getConnectionHandler, toEmit } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);

    await socket._trigger('message:send', { content: 'hello', roomId: 'room-1' });

    expect(prisma.message.create as jest.Mock).toHaveBeenCalledTimes(1);
    expect(toEmit).toHaveBeenCalledWith('message:new', expect.anything());
    expect(socket.emit).not.toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringMatching(/failed to send message/i) }),
    );
  });

  it('disconnect: an sRem rejection does not abort the rest of disconnect cleanup', async () => {
    // Mutation target: remove the try/catch around the sRem call in
    // socketService.ts → this rejection propagates out of the async
    // disconnect handler and prisma.user.update (last-seen) below it, plus
    // the typingStatus cleanup, is never reached.
    (mockRedis.sRem as jest.Mock).mockRejectedValueOnce(new Error('client offline'));
    (prisma.roomParticipant.findMany as jest.Mock).mockResolvedValue([]);

    const { io, getConnectionHandler } = buildMockIo();
    socketHandler(io as never, prisma as never, mockRedis);

    const socket = buildMockSocket({ token: makeValidJwt('user-1'), userId: 'user-1' });
    socket.userId = 'user-1';
    socket.username = 'testuser';
    socket.userType = 'HUMAN';
    await getConnectionHandler()(socket);

    (prisma.user.update as jest.Mock).mockClear();

    await expect(socket._trigger('disconnect')).resolves.not.toThrow();

    expect(mockRedis.sRem).toHaveBeenCalledWith('online_users', 'user-1');
    expect(prisma.user.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });
});
