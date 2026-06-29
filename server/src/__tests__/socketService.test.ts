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
 *
 * Mutation-check intent:
 *   - Remove the token presence check in io.use → missing-token test fails
 *     (next would be called without error).
 *   - Remove the jwt.verify call → invalid-token test fails.
 *   - Remove the `!participation` guard in message:send → non-member can
 *     emit messages (no error emitted back to socket).
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    roomParticipant: { findMany: jest.fn(), findUnique: jest.fn() },
    agentToken: { findMany: jest.fn() },
    message: { create: jest.fn(), findUnique: jest.fn() },
    room: { update: jest.fn() },
    typingStatus: { upsert: jest.fn() },
    messageReaction: { upsert: jest.fn() },
  },
}));

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

/** Build a minimal mock socket.io Server that captures use() and on() callbacks. */
function buildMockIo() {
  const useCbs: ((socket: unknown, next: (err?: Error) => void) => void)[] = [];
  const connectionCbs: ((socket: unknown) => void)[] = [];
  const toEmit = jest.fn();

  const io = {
    use: jest.fn((cb: (socket: unknown, next: (err?: Error) => void) => void) => {
      useCbs.push(cb);
    }),
    on: jest.fn((event: string, cb: (socket: unknown) => void) => {
      if (event === 'connection') connectionCbs.push(cb);
    }),
    to: jest.fn(() => ({ emit: toEmit })),
  };

  return {
    io,
    getAuthMiddleware: () => useCbs[0],
    getConnectionHandler: () => connectionCbs[0],
    toEmit,
  };
}

/** Build a minimal mock socket with configurable auth token. */
function buildMockSocket(opts: { token?: string; userId?: string } = {}) {
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const socket = {
    handshake: { auth: { token: opts.token } },
    userId: opts.userId,
    username: undefined as string | undefined,
    userType: undefined as string | undefined,
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
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
