/**
 * Regression tests for agent-tasks be5580dd: GET /api/me/dashboard
 * (routes/batch.ts) reads `req.app.get('redis')` to build its `onlineUsers`
 * field, but nothing ever called `app.set('redis', ...)`, so the lookup
 * always resolved to `undefined` and the field silently returned `[]`
 * regardless of actual presence.
 *
 * Decision (see index-redis-app-wiring.test.ts for the wiring-side pin):
 * index.ts now does `app.set("redis", redis)` with the SAME shared client
 * used by services/socketService.ts. That client's sAdd/sRem calls write
 * user ids into the "online_users" Redis set on socket connect/disconnect;
 * this route's `sMembers('online_users')` reads that same set, and
 * routes/rooms.ts's presence check reads it via `smIsMember`. One shared
 * key, one shared client — read and write sides agree.
 *
 * Follow-up, agent-tasks efb19b78: `online_users` is a single global Redis
 * set (every connected socket, platform-wide), so the be5580dd wiring fix
 * above made a real presence leak observable — any authenticated caller got
 * back everybody's online status, not just people they actually share a
 * room with. routes/batch.ts now filters that set down to userIds visible
 * to the caller, using the SAME room-participant visibility model
 * routes/rooms.ts already applies to its own per-room presence check. The
 * "shares a room" tests below pin that filter; the pre-existing "app.set"
 * and "redis call fails" tests are unaffected by scoping (both still
 * resolve to `[]` regardless of visibility) and are left as-is.
 *
 * This suite is route-level and fully mocked (no DB, no real Redis
 * connection): it stands up an isolated Express app with only batchRoutes
 * mounted, `prisma` mocked, `authenticate` mocked, and a fake redis client
 * installed via `app.set('redis', ...)` exactly the way index.ts does it —
 * mirroring the pattern used by files.test.ts / connectorProxyApproval.test.ts.
 * It therefore runs unconditionally, without RUN_DB_TESTS or a live Postgres.
 *
 * Reviewer follow-up (same task, HIGH finding): the initial scoping cut
 * built the caller's room ids straight from ALL of their RoomParticipant
 * rows, without excluding "registration" — the hidden system staging room
 * every agent account is unconditionally upserted into (routes/agents.ts),
 * and that humans may also auto-join if it is public (auth.ts's "auto-join
 * all public rooms on registration"). Counting shared membership in that
 * one room as "visible" would have re-widened the scoped set back toward
 * "everyone", the exact leak this fix exists to close. routes/batch.ts and
 * routes/rooms.ts now both filter caller-room-id lists (and this new
 * visibility computation) against the shared `HIDDEN_ROOM_IDS` constant in
 * utils/projectRoomPolicy.ts instead of each keeping its own local list.
 *
 * Follow-up, agent-tasks 3624ead1: "registration" isn't the only
 * near-universally-shared room. "onboarding" (server/prisma/seed.ts) is
 * created without `isPrivate`, so it defaults PUBLIC, and every newly
 * registered human auto-joins it via the same auth.ts step. Unlike
 * "registration" it must stay VISIBLE in room listings (it's a legitimate
 * catch-all welcome room, not a hidden system room), so it was NOT added to
 * `HIDDEN_ROOM_IDS`. Instead routes/batch.ts's callerRoomIds filter now uses
 * a new, separate `PRESENCE_EXCLUDED_ROOM_IDS` constant (a superset of
 * `HIDDEN_ROOM_IDS` that also includes "onboarding") — only for presence
 * scoping, not for listings.
 *
 * Mutation-testability:
 *   - Reverting the `if (redis) return await redis.sMembers(...)` guard's
 *     result, or breaking the app.set('redis', ...) wiring in index.ts (see
 *     the sibling test file), makes onlineUsers always `[]` — the "shares a
 *     room" test below would fail (expects the actual mocked members list,
 *     filtered).
 *   - Removing the `try { ... } catch { return [] }` guard around the Redis
 *     call would turn a rejecting sMembers() into an unhandled rejection /
 *     500 instead of a safe `[]` — the "Redis call fails" test below pins
 *     the graceful-degradation path.
 *   - Reverting the room-participant scoping (returning the raw Redis set
 *     instead of `scopedOnlineUserIds`) would make the "excludes a
 *     non-visible online user" test below fail, since the non-shared-room
 *     user would leak back into the response.
 *   - Breaking the visibility query itself (e.g. always returning `[]`
 *     participants) would make the "includes a visible online user" test
 *     fail, since even the caller's own shared-room peer would be dropped.
 *   - Re-including "registration" in the caller's room ids before the
 *     visibility query (the HIGH regression) would make the
 *     "excludes a peer whose only shared room is the hidden 'registration'
 *     room" test below fail, since that peer would leak back in.
 *   - Using `HIDDEN_ROOM_IDS` instead of `PRESENCE_EXCLUDED_ROOM_IDS` to
 *     build callerRoomIds (the 3624ead1 regression) would make the
 *     "excludes a peer whose only shared room is the public 'onboarding'
 *     room" test below fail, since "onboarding" is not in `HIDDEN_ROOM_IDS`
 *     and that peer would leak back in.
 *   - Dropping the `new Set(...)` dedup on visible userIds would not be
 *     caught by simple presence checks; the "peer in multiple shared rooms"
 *     test below asserts an exact array length to pin the dedup itself.
 */

let currentUser = {
  id: 'user-1',
  username: 'user1',
  userType: 'HUMAN',
  displayName: 'User 1',
  isAdmin: false,
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = currentUser;
    next();
  },
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    roomParticipant: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    message: { findMany: jest.fn() },
    agentToken: { findMany: jest.fn() },
  },
}));

jest.mock('../services/mentionLimiter', () => ({
  getMentionBudget: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import { getMentionBudget } from '../services/mentionLimiter';
import { batchRoutes } from '../routes/batch';

const prismaMock = prisma as unknown as {
  roomParticipant: { findMany: jest.Mock };
  project: { findMany: jest.Mock };
  task: { findMany: jest.Mock };
  message: { findMany: jest.Mock };
  agentToken: { findMany: jest.Mock };
};
const getMentionBudgetMock = getMentionBudget as jest.Mock;

/**
 * Builds an isolated Express app with only batchRoutes mounted. `redisClient`
 * is installed via `app.set('redis', ...)` exactly the way index.ts wires in
 * the shared client — omit it to reproduce the pre-fix "nothing ever called
 * app.set" state.
 */
function buildApp(redisClient?: unknown) {
  const app = express();
  app.use(express.json());
  if (redisClient !== undefined) {
    app.set('redis', redisClient);
  }
  app.use('/api/batch', batchRoutes);
  return app;
}

/**
 * Minimal shape for a `roomParticipant.findMany({ include: { room: {...} } })`
 * row, as consumed by the /me/dashboard rooms-building code (room name,
 * counts, and an empty lastMessage list — enough to not throw when the
 * handler builds its `rooms` response array).
 */
function fakeParticipation(roomId: string) {
  return {
    id: `rp-${roomId}`,
    userId: currentUser.id,
    roomId,
    role: 'MEMBER',
    joinedAt: new Date(),
    room: {
      id: roomId,
      name: `Room ${roomId}`,
      description: null,
      roomType: 'PROJECT',
      isPrivate: false,
      _count: { participants: 2, messages: 0 },
      messages: [],
    },
  };
}

interface RoomParticipantFindManyArgs {
  where?: { userId?: string; roomId?: { in?: string[] } };
}

/**
 * Wires the shared `roomParticipant.findMany` mock to answer BOTH call
 * shapes the handler makes, dispatched by argument shape rather than call
 * order — so a future reordering of the two queries in routes/batch.ts
 * can't silently break these tests via stale `mockResolvedValueOnce` chains:
 *   - `{ where: { userId } }` (the caller's own rooms, for `participations`)
 *   - `{ where: { roomId: { in: [...] } } }` (the visibility-scoping query)
 */
function mockRoomParticipants(opts: {
  participations?: ReturnType<typeof fakeParticipation>[];
  visibleParticipantRows?: { userId: string }[];
}) {
  const participations = opts.participations ?? [];
  const visibleParticipantRows = opts.visibleParticipantRows ?? [];
  prismaMock.roomParticipant.findMany.mockImplementation(
    async (args: RoomParticipantFindManyArgs) => {
      if (args?.where?.roomId) return visibleParticipantRows;
      if (args?.where?.userId) return participations;
      return [];
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = {
    id: 'user-1',
    username: 'user1',
    userType: 'HUMAN',
    displayName: 'User 1',
    isAdmin: false,
  };
  // Default: caller is in no rooms, so the visibility-scoping query (the
  // second roomParticipant.findMany call, keyed by roomId) also has nothing
  // to look up and resolves to `[]` via the same default below.
  prismaMock.roomParticipant.findMany.mockResolvedValue([]);
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.agentToken.findMany.mockResolvedValue([]);
  getMentionBudgetMock.mockResolvedValue({ current: 0, limit: 15, remaining: 15 });
});

describe('GET /api/me/dashboard — onlineUsers via app.get("redis")', () => {
  it('includes an online user who shares a room with the caller', async () => {
    // Caller (user-1) participates in "room-shared"; user-2 is another
    // participant of that same room (the roomId-keyed visibility query).
    mockRoomParticipants({
      participations: [fakeParticipation('room-shared')],
      visibleParticipantRows: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(sMembers).toHaveBeenCalledWith('online_users');
    expect(res.body.onlineUsers).toEqual(expect.arrayContaining(['user-1', 'user-2']));
    expect(res.body.onlineUsers).toHaveLength(2);
  });

  it('excludes an online user who does not share any room with the caller', async () => {
    // Same shared-room setup as above, but the global Redis set also
    // reports "user-3" online — someone who is not a participant of any
    // room the caller is in, so they must not leak into the response.
    mockRoomParticipants({
      participations: [fakeParticipation('room-shared')],
      visibleParticipantRows: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2', 'user-3']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual(expect.arrayContaining(['user-1', 'user-2']));
    expect(res.body.onlineUsers).not.toContain('user-3');
    expect(res.body.onlineUsers).toHaveLength(2);
  });

  it('excludes a peer whose only shared room with the caller is the hidden "registration" room', async () => {
    // Caller's ONLY RoomParticipant row is "registration" — the hidden
    // system staging room (see HIDDEN_ROOM_IDS in utils/projectRoomPolicy.ts)
    // every agent account is unconditionally upserted into, and that
    // "user-2" also happens to participate in. Before the HIGH fix,
    // callerRoomIds included "registration" unfiltered, so the
    // roomId-scoped visibility query would have reported user-2 as
    // "visible" and it would leak into onlineUsers below. After the fix,
    // "registration" is excluded before it ever seeds that query, so the
    // caller effectively has zero real shared rooms and nobody (not even
    // the caller) is considered visible.
    mockRoomParticipants({
      participations: [fakeParticipation('registration')],
      // Only reachable if the fix regresses and "registration" leaks
      // through into the roomId-scoped query below.
      visibleParticipantRows: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).not.toContain('user-2');
    expect(res.body.onlineUsers).toEqual([]);
  });

  it('excludes a peer whose only shared room with the caller is the public "onboarding" room', async () => {
    // Caller's ONLY RoomParticipant row is "onboarding" — the public
    // catch-all welcome room (server/prisma/seed.ts, created without
    // `isPrivate` so it defaults PUBLIC) that every newly registered human
    // auto-joins via auth.ts's "auto-join all public rooms on registration"
    // step, and that "user-2" also happens to participate in. Unlike
    // "registration" this room is NOT in `HIDDEN_ROOM_IDS` (it must stay
    // visible in room listings), but it IS in `PRESENCE_EXCLUDED_ROOM_IDS`
    // (see utils/projectRoomPolicy.ts): near-universal shared membership in
    // a public catch-all room is not a meaningful "shares a room with me"
    // signal for presence purposes. Before this fix, callerRoomIds included
    // "onboarding" unfiltered, so the roomId-scoped visibility query would
    // have reported user-2 as "visible" and it would leak into onlineUsers
    // below. After the fix, "onboarding" is excluded before it ever seeds
    // that query, so the caller effectively has zero real shared rooms and
    // nobody (not even the caller) is considered visible.
    mockRoomParticipants({
      participations: [fakeParticipation('onboarding')],
      // Only reachable if the fix regresses and "onboarding" leaks through
      // into the roomId-scoped query below.
      visibleParticipantRows: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).not.toContain('user-2');
    expect(res.body.onlineUsers).toEqual([]);
  });

  it('keeps a peer visible via multiple shared rooms (listed once)', async () => {
    // Caller shares TWO rooms with "user-2" (e.g. a project room and a
    // direct room). The roomId-scoped query returns one RoomParticipant
    // row per (userId, roomId) pair, so user-2 appears twice in the raw
    // rows. This pins that duplicate visibility rows neither drop nor
    // duplicate the peer in the response. Note: output uniqueness is
    // ultimately guaranteed by the Redis sMembers set being unique, not
    // by the visibleParticipants Set, so this test does not by itself
    // pin that Set — it pins the multi-room path staying correct.
    mockRoomParticipants({
      participations: [fakeParticipation('room-a'), fakeParticipation('room-b')],
      visibleParticipantRows: [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-1' },
        { userId: 'user-2' },
      ],
    });
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual(expect.arrayContaining(['user-1', 'user-2']));
    expect(res.body.onlineUsers).toHaveLength(2);
  });

  it('returns [] when the caller has no rooms at all, even if the caller themself is online', async () => {
    // Self-presence edge case: a caller with zero RoomParticipant rows has
    // an empty visible set, so even their OWN userId being in the global
    // Redis online_users set does not make it back into the response.
    mockRoomParticipants({ participations: [], visibleParticipantRows: [] });
    const sMembers = jest.fn().mockResolvedValue(['user-1']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual([]);
  });

  it('returns [] (does not crash) when nothing has app.set("redis", ...) — the original bug', async () => {
    // Reproduces the pre-fix state: req.app.get('redis') resolves to
    // undefined, so the `if (redis)` guard short-circuits.
    const app = buildApp(undefined);

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual([]);
  });

  it('returns [] when the Redis call itself fails, instead of a 500', async () => {
    const sMembers = jest.fn().mockRejectedValue(new Error('connection reset'));
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual([]);
  });
});
