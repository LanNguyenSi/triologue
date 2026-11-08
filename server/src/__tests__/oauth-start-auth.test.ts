/**
 * OAuth start routes behind the REAL authenticate and requireHuman
 * middleware (only prisma and the agent-token lookup are mocked).
 *
 * `authenticate` accepts `Authorization: Bearer byoa_...` and a bare
 * `byoa_...`; both must be refused by POST /oauth/start-token, and so must an
 * agent user's own JWT. The decision is on the resolved userType, not on the
 * header text.
 *
 * Mutation-check intent:
 *   - Remove `requireHuman` from POST /oauth/start-token → the bare, Bearer
 *     and agent-JWT cases below return 200 with a token.
 *   - Remove `requireHuman` from GET /oauth/start → the header and st agent
 *     cases return 302.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    integrationToken: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../services/agentTokenRotation', () => ({
  findAgentTokenByRawToken: jest.fn(),
}));

jest.mock('../services/tokenManager', () => ({
  getTokenForUser: jest.fn().mockResolvedValue(null),
  listIntegrations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../connectors/registry', () => ({
  listEnabledConnectors: jest.fn().mockReturnValue([]),
  getEnabledConnector: jest.fn().mockReturnValue(null),
  initConnectors: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import jwt from 'jsonwebtoken';
import request from './helpers/loopbackRequest';
import prisma from '../lib/prisma';
import { findAgentTokenByRawToken } from '../services/agentTokenRotation';
import integrationsRouter from '../routes/integrations';
import { mintOAuthStartToken } from '../lib/scopedToken';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRouter);
  return app;
}

const MINT = '/api/integrations/oauth/start-token';
const START = '/api/integrations/oauth/start';

const human = { id: 'human-1', username: 'h', userType: 'HUMAN', displayName: 'H', isAdmin: false, isActive: true, canTriggerAI: true };
const agentUser = { id: 'agent-1', username: 'a', userType: 'AI_AGENT', displayName: 'A', isAdmin: false, isActive: true, canTriggerAI: false };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
  (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === human.id ? human : where.id === agentUser.id ? agentUser : null,
  );
  (findAgentTokenByRawToken as jest.Mock).mockResolvedValue({
    isActive: true,
    status: 'active',
    agentUser,
  });
});

afterEach(() => {
  delete process.env.MICROSOFT_CLIENT_ID;
});

describe('POST /oauth/start-token with the real authenticate middleware', () => {
  it.each([
    ['Bearer byoa_ header', 'Bearer byoa_agent_secret'],
    ['bare byoa_ header', 'byoa_agent_secret'],
  ])('refuses an agent token sent as %s (403, no token)', async (_label, header) => {
    const res = await request(buildApp()).post(MINT).set('Authorization', header).send({ provider: 'microsoft' });

    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    expect(findAgentTokenByRawToken).toHaveBeenCalled();
  });

  it("refuses an agent user's own JWT (403)", async () => {
    const agentJwt = jwt.sign({ userId: agentUser.id }, process.env.JWT_SECRET!);

    const res = await request(buildApp()).post(MINT).set('Authorization', `Bearer ${agentJwt}`).send({ provider: 'microsoft' });

    expect(res.status).toBe(403);
  });

  it('mints for a human session JWT', async () => {
    const humanJwt = jwt.sign({ userId: human.id }, process.env.JWT_SECRET!);

    const res = await request(buildApp()).post(MINT).set('Authorization', `Bearer ${humanJwt}`).send({ provider: 'microsoft', scope: 'teams' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});

describe('GET /oauth/start with the real authenticate middleware', () => {
  it.each([
    ['Bearer byoa_ header', 'Bearer byoa_agent_secret'],
    ['bare byoa_ header', 'byoa_agent_secret'],
  ])('refuses an agent token sent as %s (403)', async (_label, header) => {
    const res = await request(buildApp()).get(START).set('Authorization', header).query({ provider: 'microsoft', scope: 'teams' });

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  it('refuses an st token minted for an agent user (403)', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', agentUser.id);

    const res = await request(buildApp()).get(START).query({ provider: 'microsoft', scope: 'teams', st: token });

    expect(res.status).toBe(403);
  });

  it('redirects for a human session JWT in the header and for a human st token', async () => {
    const humanJwt = jwt.sign({ userId: human.id }, process.env.JWT_SECRET!);
    const app = buildApp();

    const viaHeader = await request(app).get(START).set('Authorization', `Bearer ${humanJwt}`).query({ provider: 'microsoft', scope: 'teams' });
    expect(viaHeader.status).toBe(302);

    const { token } = mintOAuthStartToken('microsoft', 'teams', human.id);
    const viaSt = await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: token });
    expect(viaSt.status).toBe(302);
  });
});
