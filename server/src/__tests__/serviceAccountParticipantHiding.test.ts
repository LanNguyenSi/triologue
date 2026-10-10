/**
 * The service-account usernames (gateway, gateway-agent-001) are hidden from
 * the participant list of GET /api/rooms/:roomId and from
 * GET /api/users/room/:roomId, while ordinary participants stay visible.
 *
 * Route-level unit test with a mocked prisma, a mocked authenticate
 * middleware and a mocked redis client (no DB, no Redis).
 */
import express from 'express';
import request from './helpers/loopbackRequest';

jest.mock('redis', () => ({
  createClient: () => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    smIsMember: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'requester-1' };
    next();
  },
}));

jest.mock('../lib/prisma', () => {
  const g = globalThis as { __svcHidingPrismaMock?: object };
  g.__svcHidingPrismaMock ??= {
    roomParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    room: { findUnique: jest.fn() },
    project: { findFirst: jest.fn() },
    message: { findMany: jest.fn() },
    agentToken: { findMany: jest.fn() },
  };
  return { __esModule: true, default: g.__svcHidingPrismaMock };
});

import prisma from '../lib/prisma';
import { roomRoutes } from '../routes/rooms';
import { userRoutes } from '../routes/users';

const prismaMock = prisma as unknown as {
  roomParticipant: { findUnique: jest.Mock; findMany: jest.Mock };
  room: { findUnique: jest.Mock };
  project: { findFirst: jest.Mock };
  message: { findMany: jest.Mock };
  agentToken: { findMany: jest.Mock };
};

const makeUser = (id: string, username: string) => ({
  id,
  username,
  displayName: username,
  userType: 'HUMAN',
  avatar: null,
  isActive: true,
  lastSeen: null,
});

const people = [
  makeUser('u-gw', 'gateway'),
  makeUser('u-gwa', 'gateway-agent-001'),
  makeUser('u-ok', 'plain_human'),
];

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use('/api/rooms', roomRoutes);
  a.use('/api/users', userRoutes);
  return a;
}

beforeEach(() => {
  prismaMock.roomParticipant.findUnique.mockResolvedValue({ userId: 'requester-1', roomId: 'room-1' });
  prismaMock.project.findFirst.mockResolvedValue(null);
  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.agentToken.findMany.mockResolvedValue([]);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/rooms/:roomId participants', () => {
  it('hides both service accounts and keeps an ordinary participant', async () => {
    prismaMock.room.findUnique.mockResolvedValue({
      id: 'room-1',
      name: 'Room',
      description: null,
      roomType: 'GENERAL',
      isPrivate: false,
      _count: { participants: 3, messages: 0 },
      participants: people.map((user) => ({ user, role: 'MEMBER', joinedAt: new Date(0) })),
    });

    const response = await request(app()).get('/api/rooms/room-1');

    expect(response.status).toBe(200);
    const names = response.body.participants.map((p: { username: string }) => p.username);
    expect(names).toEqual(['plain_human']);
  });
});

describe('GET /api/users/room/:roomId', () => {
  it('hides both service accounts and keeps an ordinary participant', async () => {
    prismaMock.roomParticipant.findMany.mockResolvedValue(people.map((user) => ({ user })));

    const response = await request(app()).get('/api/users/room/room-1');

    expect(response.status).toBe(200);
    const names = response.body.map((u: { username: string }) => u.username);
    expect(names).toEqual(['plain_human']);
  });
});
