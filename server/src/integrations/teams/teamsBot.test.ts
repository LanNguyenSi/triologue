import express from 'express';
import request from 'supertest';

// The Teams webhook handler calls handleTeamsMessage() and touches prisma via
// sibling modules. Mock both so the test exercises only the auth gate without a
// database or real Teams sync.
jest.mock('./teamsSync', () => ({
  handleTeamsMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    room: { findUnique: jest.fn() },
  },
}));

import { teamsRoutes } from './teamsBot';
import { handleTeamsMessage } from './teamsSync';

const mockedHandleTeamsMessage = handleTeamsMessage as jest.MockedFunction<
  typeof handleTeamsMessage
>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teams', teamsRoutes);
  return app;
}

// A Teams "message" activity that mentions the bot. The handler only invokes
// handleTeamsMessage when the activity is a mention with remaining text.
const messageActivity = {
  type: 'message',
  text: '<at>bot</at> hello there',
  entities: [{ type: 'mention', text: '<at>bot</at>' }],
  from: { id: 'user-1', name: 'Tester' },
  conversation: { id: 'conv-1' },
  channelData: { channel: { id: 'channel-1' }, tenant: { id: 'tenant-1' } },
};

const SECRET = 'super-secret-teams-token';

describe('POST /api/teams/webhook authentication', () => {
  const originalSecret = process.env.TEAMS_BOT_SECRET;

  afterEach(() => {
    mockedHandleTeamsMessage.mockClear();
    if (originalSecret === undefined) {
      delete process.env.TEAMS_BOT_SECRET;
    } else {
      process.env.TEAMS_BOT_SECRET = originalSecret;
    }
  });

  it('returns 503 when TEAMS_BOT_SECRET is unset', async () => {
    delete process.env.TEAMS_BOT_SECRET;

    const res = await request(buildApp())
      .post('/api/teams/webhook')
      .send(messageActivity);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Webhook not configured' });
    expect(mockedHandleTeamsMessage).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret is set but no Authorization header is sent', async () => {
    process.env.TEAMS_BOT_SECRET = SECRET;

    const res = await request(buildApp())
      .post('/api/teams/webhook')
      .send(messageActivity);

    expect(res.status).toBe(401);
    expect(mockedHandleTeamsMessage).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong Bearer token longer than 10 chars', async () => {
    process.env.TEAMS_BOT_SECRET = SECRET;

    const res = await request(buildApp())
      .post('/api/teams/webhook')
      .set('Authorization', 'Bearer this-is-a-wrong-but-long-token')
      .send(messageActivity);

    expect(res.status).toBe(401);
    expect(mockedHandleTeamsMessage).not.toHaveBeenCalled();
  });

  it('returns 200 and invokes handleTeamsMessage for the correct Bearer token', async () => {
    process.env.TEAMS_BOT_SECRET = SECRET;

    const res = await request(buildApp())
      .post('/api/teams/webhook')
      .set('Authorization', `Bearer ${SECRET}`)
      .send(messageActivity);

    expect(res.status).toBe(200);
    expect(mockedHandleTeamsMessage).toHaveBeenCalledTimes(1);
  });
});
