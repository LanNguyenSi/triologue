/**
 * DB-backed integration suite for POST /api/agents/:id/token/rotate and the
 * previous-token grace window across every bearer lookup site.
 *
 * Gated on RUN_DB_TESTS=1 (needs a migrated Postgres, DATABASE_URL). Runs
 * serially (--runInBand) because the gateway fixture is the one User whose
 * username is exactly "gateway-agent-001". Time is never slept: a grace
 * window is closed by writing previousTokenExpiresAt into the past.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import util from 'util';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import * as auditService from '../services/auditService';
import * as rotationService from '../services/agentTokenRotation';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const PREFIX = 'atrot';
const GATEWAY_USERNAME = 'gateway-agent-001';
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

interface AgentFixture {
  id: string; // AgentToken id
  userId: string;
  token: string;
}

let seq = 0;
function uniq(label: string) {
  seq += 1;
  return `${PREFIX}-${label}-${Date.now().toString(36)}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}
function newToken() {
  return 'byoa_' + crypto.randomBytes(32).toString('hex');
}

const createdUserIds: string[] = [];
const createdFiles: string[] = [];
let creator: { id: string; jwt: string };
let admin: { id: string; jwt: string };
let outsider: { id: string; jwt: string };
let gateway: AgentFixture;

function signJwt(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function makeHuman(label: string, isAdmin = false) {
  const user = await prisma.user.create({
    data: { username: uniq(label), displayName: `AT ${label}`, userType: 'HUMAN', isAdmin },
  });
  createdUserIds.push(user.id);
  return { id: user.id, jwt: signJwt(user.id) };
}

async function makeAgent(
  label: string,
  opts: { username?: string; status?: string; isActive?: boolean; createdById?: string } = {},
): Promise<AgentFixture> {
  const user = await prisma.user.create({
    data: { username: opts.username ?? uniq(label), displayName: `AT ${label}`, userType: 'AI_AGENT' },
  });
  createdUserIds.push(user.id);
  const token = newToken();
  const row = await prisma.agentToken.create({
    data: {
      token,
      name: `AT ${label}`,
      mentionKey: uniq('mk'),
      userId: user.id,
      createdById: opts.createdById ?? creator.id,
      status: opts.status ?? 'active',
      isActive: opts.isActive ?? true,
    },
  });
  return { id: row.id, userId: user.id, token };
}

function rotate(agentId: string, headers: { gateway?: string | null; proof?: string | null } = {}) {
  const req = request(app).post(`/api/agents/${agentId}/token/rotate`);
  const gw = headers.gateway === undefined ? gateway.token : headers.gateway;
  if (gw !== null) req.set('Authorization', `Bearer ${gw}`);
  if (headers.proof !== null && headers.proof !== undefined) req.set('X-Agent-Token', headers.proof);
  return req;
}

async function row(agentId: string) {
  return prisma.agentToken.findUniqueOrThrow({ where: { id: agentId } });
}

/** Close the grace window without sleeping. */
async function expireGrace(agentId: string) {
  await prisma.agentToken.update({
    where: { id: agentId },
    data: { previousTokenExpiresAt: new Date(Date.now() - 1000) },
  });
}

const bearer = (t: string) => `Bearer ${t}`;
const auditStatus = (t: string) => request(app).get('/api/agents/audit').set('Authorization', bearer(t));
const authenticateStatus = (t: string) => request(app).get('/api/agents/mine').set('Authorization', bearer(t));
const filesStatus = (t: string, file: string) => request(app).get(`/api/files/${file}`).set('Authorization', bearer(t));
const connectorStatus = (t: string) =>
  request(app).post('/api/connectors/no-such-connector/actions/none').set('Authorization', bearer(t)).send({});

async function configEntry(userId: string) {
  const res = await request(app).get('/api/agents/gateway-config').set('Authorization', bearer(gateway.token));
  expect(res.status).toBe(200);
  const entry = (res.body.agents as Array<Record<string, unknown>>).find((a) => a.userId === userId);
  return entry;
}

async function deleteGatewayFixture() {
  const users = await prisma.user.findMany({ where: { username: GATEWAY_USERNAME }, select: { id: true } });
  for (const u of users) {
    await prisma.agentToken.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}

describeOrSkip('POST /api/agents/:id/token/rotate (DB)', () => {
  let auditSpy: jest.SpyInstance;
  let prevGraceEnv: string | undefined;

  beforeAll(async () => {
    prevGraceEnv = process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
    delete process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
    await deleteGatewayFixture();
    creator = await makeHuman('creator');
    admin = await makeHuman('admin', true);
    outsider = await makeHuman('outsider');
    gateway = await makeAgent('gateway', { username: GATEWAY_USERNAME });
  });

  afterAll(async () => {
    await prisma.agentAuditLog.deleteMany({ where: { agentId: { in: createdUserIds } } });
    await prisma.agentToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await deleteGatewayFixture();
    for (const f of createdFiles) fs.rmSync(f, { force: true });
    await prisma.$disconnect();
    if (prevGraceEnv === undefined) delete process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
    else process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS = prevGraceEnv;
  });

  beforeEach(() => {
    // The spy keeps the route from writing audit rows that outlive a test's
    // fixtures; every call is recorded for the audit assertions.
    auditSpy = jest.spyOn(auditService, 'logAuditEvent').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── mint ──────────────────────────────────────────────────────────────

  describe('mint', () => {
    it('rotates with gateway bearer + current token and persists the swap', async () => {
      const agent = await makeAgent('mint');
      const before = Date.now();

      const res = await rotate(agent.id, { proof: agent.token });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body).sort()).toEqual(['agentId', 'graceSeconds', 'previousTokenExpiresAt', 'token']);
      expect(res.body.agentId).toBe(agent.id);
      expect(res.body.token).toMatch(/^byoa_[0-9a-f]{64}$/);
      expect(res.body.token).not.toBe(agent.token);
      expect(res.body.graceSeconds).toBe(300);

      const stored = await row(agent.id);
      expect(stored.token).toBe(res.body.token);
      expect(stored.previousToken).toBe(agent.token);
      expect(new Date(res.body.previousTokenExpiresAt).getTime()).toBe(stored.previousTokenExpiresAt!.getTime());
      const expected = before + 300_000;
      expect(Math.abs(stored.previousTokenExpiresAt!.getTime() - expected)).toBeLessThan(30_000);
    });

    it('honours AGENT_TOKEN_ROTATE_GRACE_SECONDS (clamped)', async () => {
      const agent = await makeAgent('graceenv');
      process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS = '5';
      try {
        const res = await rotate(agent.id, { proof: agent.token });
        expect(res.status).toBe(200);
        expect(res.body.graceSeconds).toBe(30);
      } finally {
        delete process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
      }
    });
  });

  // ── grace window through every lookup site ────────────────────────────

  describe('previous token across the bearer lookup sites', () => {
    let agent: AgentFixture;
    let oldToken: string;
    let newTok: string;
    let fileName: string;

    beforeAll(async () => {
      fileName = `${uniq('file')}.txt`;
      const filePath = path.join(UPLOAD_DIR, fileName);
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(filePath, 'rotation test');
      createdFiles.push(filePath);

      agent = await makeAgent('sites');
      oldToken = agent.token;
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);
      newTok = res.body.token;
    });

    it('accepts the old token inside the window on byoaAuth, authenticate, files and the connector proxy', async () => {
      expect((await auditStatus(oldToken)).status).toBe(200);
      expect((await authenticateStatus(oldToken)).status).toBe(200);
      expect((await filesStatus(oldToken, fileName)).status).not.toBe(401);
      expect((await connectorStatus(oldToken)).status).toBe(404); // past auth: connector unknown
    });

    it('rejects the old token with 401 on all four sites once the window closes; the new token keeps working', async () => {
      await expireGrace(agent.id);

      expect((await auditStatus(oldToken)).status).toBe(401);
      expect((await authenticateStatus(oldToken)).status).toBe(401);
      expect((await filesStatus(oldToken, fileName)).status).toBe(401);
      expect((await connectorStatus(oldToken)).status).toBe(401);

      expect((await auditStatus(newTok)).status).toBe(200);
      expect((await authenticateStatus(newTok)).status).toBe(200);
      expect((await filesStatus(newTok, fileName)).status).not.toBe(401);
      expect((await connectorStatus(newTok)).status).toBe(404);
    });
  });

  // ── double rotate, retry, concurrency ─────────────────────────────────

  describe('double rotate, retry and concurrency', () => {
    it('second rotation kills the first old token at once and keeps exactly one previous token', async () => {
      const agent = await makeAgent('double');
      const t0 = agent.token;
      const first = await rotate(agent.id, { proof: t0 });
      expect(first.status).toBe(200);
      const t1: string = first.body.token;
      expect((await auditStatus(t0)).status).toBe(200); // inside the first window

      const second = await rotate(agent.id, { proof: t1 });
      expect(second.status).toBe(200);
      const t2: string = second.body.token;

      expect((await auditStatus(t0)).status).toBe(401); // first old token dead now
      expect((await auditStatus(t1)).status).toBe(200); // previous until the new window ends
      expect((await auditStatus(t2)).status).toBe(200);

      const stored = await row(agent.id);
      expect(stored.token).toBe(t2);
      expect(stored.previousToken).toBe(t1);
      expect(stored.previousTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.agentToken.count({ where: { OR: [{ token: t0 }, { previousToken: t0 }] } })).toBe(0);

      await expireGrace(agent.id);
      expect((await auditStatus(t1)).status).toBe(401); // until the new window ends
    });

    it('rejects a retry with the OLD token as proof (403) and leaks neither token', async () => {
      const agent = await makeAgent('retry');
      const first = await rotate(agent.id, { proof: agent.token });
      expect(first.status).toBe(200);
      const rowAfterFirst = await row(agent.id);

      const retry = await rotate(agent.id, { proof: agent.token });

      expect(retry.status).toBe(403);
      expect(retry.body).toEqual({ error: 'Current agent token required' });
      expect(JSON.stringify(retry.body)).not.toContain(agent.token);
      expect(JSON.stringify(retry.body)).not.toContain(first.body.token);
      expect(JSON.stringify(retry.headers)).not.toContain(first.body.token);
      const rowAfterRetry = await row(agent.id);
      expect(rowAfterRetry.token).toBe(rowAfterFirst.token);
      expect(rowAfterRetry.previousToken).toBe(rowAfterFirst.previousToken);
    });

    it('two concurrent rotations with the same current token yield exactly one 200 and one 409', async () => {
      const agent = await makeAgent('race');
      // Hold both requests at the swap until both have passed the proof
      // check, so the compare-and-swap alone decides the winner.
      const realRotate = rotationService.rotateAgentToken;
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const safety = setTimeout(() => release(), 5000);
      safety.unref();
      jest.spyOn(rotationService, 'rotateAgentToken').mockImplementation(async (...args) => {
        arrived += 1;
        if (arrived >= 2) release();
        await gate;
        return realRotate(...args);
      });

      const [a, b] = await Promise.all([
        rotate(agent.id, { proof: agent.token }),
        rotate(agent.id, { proof: agent.token }),
      ]);
      clearTimeout(safety);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      const winner = a.status === 200 ? a : b;
      expect(loser.body).toEqual({ error: 'Token was rotated concurrently; retry with the current token' });
      const stored = await row(agent.id);
      expect(stored.token).toBe(winner.body.token);
      expect(stored.previousToken).toBe(agent.token);
    });
  });

  // ── authorization ────────────────────────────────────────────────────

  describe('authorization', () => {
    let agent: AgentFixture;
    beforeAll(async () => {
      agent = await makeAgent('authz');
    });
    afterEach(async () => {
      // every case below must leave the agent untouched
      const stored = await row(agent.id);
      expect(stored.token).toBe(agent.token);
      expect(stored.previousToken).toBeNull();
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('401 without an Authorization header', async () => {
      const res = await rotate(agent.id, { gateway: null, proof: agent.token });
      expect(res.status).toBe(401);
    });

    it('403 for a valid byoa_ token of an ordinary agent', async () => {
      const ordinary = await makeAgent('ordinary');
      const res = await rotate(agent.id, { gateway: ordinary.token, proof: agent.token });
      expect(res.status).toBe(403);
    });

    it('403 when the agent presents its own token as the gateway bearer', async () => {
      const res = await rotate(agent.id, { gateway: agent.token, proof: agent.token });
      expect(res.status).toBe(403);
    });

    it('never rotates for a human or admin JWT', async () => {
      for (const who of [creator, admin, outsider]) {
        const res = await rotate(agent.id, { gateway: who.jwt, proof: agent.token });
        expect({ status: [401, 403].includes(res.status) ? 'rejected' : res.status, body: res.body }).toEqual({
          status: 'rejected',
          body: expect.anything(),
        });
      }
    });

    it('403 without X-Agent-Token', async () => {
      const res = await rotate(agent.id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Current agent token required' });
    });

    it('403 with a wrong X-Agent-Token (same length and different length)', async () => {
      const sameLength = 'byoa_' + 'a'.repeat(agent.token.length - 5);
      expect((await rotate(agent.id, { proof: sameLength })).status).toBe(403);
      expect((await rotate(agent.id, { proof: 'byoa_short' })).status).toBe(403);
    });

    it('rejects a gateway bearer whose own token is inactive', async () => {
      await prisma.agentToken.update({ where: { id: gateway.id }, data: { isActive: false } });
      try {
        const res = await rotate(agent.id, { proof: agent.token });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Gateway token required' });
      } finally {
        await prisma.agentToken.update({ where: { id: gateway.id }, data: { isActive: true } });
      }
    });

    it('rejects a gateway bearer whose own token status is not active', async () => {
      await prisma.agentToken.update({ where: { id: gateway.id }, data: { status: 'rejected' } });
      try {
        const res = await rotate(agent.id, { proof: agent.token });
        expect(res.status).toBe(403);
      } finally {
        await prisma.agentToken.update({ where: { id: gateway.id }, data: { status: 'active' } });
      }
    });

    it('404 for an unknown agent id', async () => {
      const res = await rotate('no-such-agent-id', { proof: agent.token });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });

    it('404 for an agent whose user is deleted', async () => {
      const gone = await makeAgent('gone');
      await prisma.user.update({ where: { id: gone.userId }, data: { isDeleted: true } });
      const res = await rotate(gone.id, { proof: gone.token });
      expect(res.status).toBe(404);
      expect((await row(gone.id)).token).toBe(gone.token);
    });

    it('403 for an agent with isActive false or a status other than active', async () => {
      const inactive = await makeAgent('inactive', { isActive: false });
      const pending = await makeAgent('pending', { status: 'pending' });
      const rejected = await makeAgent('rejected', { status: 'rejected', isActive: false });
      for (const a of [inactive, pending, rejected]) {
        const res = await rotate(a.id, { proof: a.token });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Agent is not active' });
        expect((await row(a.id)).token).toBe(a.token);
      }
    });

    it('403 when the agent token row is active but the agent user is deactivated', async () => {
      const a = await makeAgent('user-inactive');
      await prisma.user.update({ where: { id: a.userId }, data: { isActive: false } });
      const res = await rotate(a.id, { proof: a.token });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Agent is not active' });
      const stored = await row(a.id);
      expect(stored.token).toBe(a.token);
      expect(stored.previousToken).toBeNull();
    });
  });

  // ── a rotation racing a revocation ───────────────────────────────────

  describe('rotation racing a revocation', () => {
    /**
     * Hold the rotation at the swap, run `revoke` once the route has reached
     * it, then release. The compare-and-swap filters on isActive/status, so
     * the swap must not commit for a row that was revoked in between.
     */
    async function rotateRacingRevoke(agent: AgentFixture, revoke: () => Promise<unknown>) {
      const realRotate = rotationService.rotateAgentToken;
      let signalArrived!: () => void;
      const arrived = new Promise<void>((resolve) => {
        signalArrived = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const safety = setTimeout(() => release(), 5000);
      safety.unref();
      jest.spyOn(rotationService, 'rotateAgentToken').mockImplementation(async (...args) => {
        signalArrived();
        await gate;
        return realRotate(...args);
      });

      const pending = rotate(agent.id, { proof: agent.token }).then((r) => r);
      await arrived;
      await revoke();
      release();
      const res = await pending;
      clearTimeout(safety);
      return res;
    }

    it.each([
      [
        'an admin reject',
        (a: AgentFixture) =>
          request(app)
            .patch(`/api/agents/${a.id}/activate`)
            .set('Authorization', bearer(admin.jwt))
            .send({ action: 'reject' }),
      ],
      [
        'a delete',
        (a: AgentFixture) => request(app).delete(`/api/agents/${a.id}`).set('Authorization', bearer(creator.jwt)),
      ],
    ])('does not commit when %s lands between the checks and the swap', async (_label, doRevoke) => {
      const agent = await makeAgent('racerevoke');

      const res = await rotateRacingRevoke(agent, async () => {
        const revoked = await doRevoke(agent);
        expect(revoked.status).toBe(200);
      });

      expect(res.status).not.toBe(200);
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toContain('byoa_');
      const stored = await row(agent.id);
      expect(stored.token).toBe(agent.token);
      expect(stored.previousToken).toBeNull();
      expect(stored.isActive).toBe(false);
      const rotations = auditSpy.mock.calls.filter((c) => c[0].action === 'agent.token.rotate');
      expect(rotations).toHaveLength(0);
    });
  });

  // ── listings never carry a bearer secret ─────────────────────────────

  describe('agent listings redact the token slots', () => {
    it('GET /api/agents/mine and the admin list return neither the old nor the new token after a rotation', async () => {
      const agent = await makeAgent('listing');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);
      const newTok: string = res.body.token;

      const mine = await request(app).get('/api/agents/mine').set('Authorization', bearer(creator.jwt));
      expect(mine.status).toBe(200);
      const mineRow = (mine.body as Array<Record<string, unknown>>).find((a) => a.id === agent.id);
      expect(mineRow).toBeDefined();
      expect(mineRow).toMatchObject({ token: '[redacted]', previousToken: null, hasPreviousToken: true });
      expect(JSON.stringify(mine.body)).not.toContain(agent.token);
      expect(JSON.stringify(mine.body)).not.toContain(newTok);

      const list = await request(app).get('/api/agents').set('Authorization', bearer(admin.jwt));
      expect(list.status).toBe(200);
      const listRow = (list.body as Array<Record<string, unknown>>).find((a) => a.id === agent.id);
      expect(listRow).toMatchObject({ token: '[redacted]', previousToken: null, hasPreviousToken: true });
      const paged = await request(app).get('/api/agents?limit=100&page=1').set('Authorization', bearer(admin.jwt));
      expect(paged.status).toBe(200);
      for (const body of [list.body, paged.body]) {
        expect(JSON.stringify(body)).not.toContain(agent.token);
        expect(JSON.stringify(body)).not.toContain(newTok);
      }

      // an expired window is still a secret and stays out of the listing
      await expireGrace(agent.id);
      const after = await request(app).get('/api/agents/mine').set('Authorization', bearer(creator.jwt));
      const afterRow = (after.body as Array<Record<string, unknown>>).find((a) => a.id === agent.id);
      expect(afterRow).toMatchObject({ previousToken: null, hasPreviousToken: false });
      expect(JSON.stringify(after.body)).not.toContain(agent.token);
    });

    it('an agent that never rotated reports no previous token', async () => {
      const agent = await makeAgent('listing-clean');
      const mine = await request(app).get('/api/agents/mine').set('Authorization', bearer(creator.jwt));
      const mineRow = (mine.body as Array<Record<string, unknown>>).find((a) => a.id === agent.id);
      expect(mineRow).toMatchObject({ token: '[redacted]', previousToken: null, hasPreviousToken: false });
      expect(JSON.stringify(mine.body)).not.toContain(agent.token);
    });
  });

  // ── revocation + gateway-config ──────────────────────────────────────

  describe('revocation and gateway-config', () => {
    it('an admin reject revokes both the new and the previous token and drops the agent from gateway-config', async () => {
      const agent = await makeAgent('revoke');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);
      const newTok: string = res.body.token;
      expect((await auditStatus(agent.token)).status).toBe(200);
      expect(await configEntry(agent.userId)).toBeDefined();

      const reject = await request(app)
        .patch(`/api/agents/${agent.id}/activate`)
        .set('Authorization', bearer(admin.jwt))
        .send({ action: 'reject' });
      expect(reject.status).toBe(200);

      expect([401, 403]).toContain((await auditStatus(newTok)).status);
      expect([401, 403]).toContain((await auditStatus(agent.token)).status);
      expect(await configEntry(agent.userId)).toBeUndefined();
      const stored = await row(agent.id);
      expect(stored.previousToken).toBeNull();
      expect(stored.previousTokenExpiresAt).toBeNull();
    });

    it.each([
      ['the creator', () => creator],
      ['an admin', () => admin],
    ])('DELETE by %s revokes both tokens and drops the agent from gateway-config', async (_label, who) => {
      const agent = await makeAgent('delete');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);
      const newTok: string = res.body.token;

      const del = await request(app).delete(`/api/agents/${agent.id}`).set('Authorization', bearer(who().jwt));
      expect(del.status).toBe(200);

      expect([401, 403]).toContain((await auditStatus(newTok)).status);
      expect([401, 403]).toContain((await auditStatus(agent.token)).status);
      expect(await configEntry(agent.userId)).toBeUndefined();
      const stored = await row(agent.id);
      expect(stored.previousToken).toBeNull();
      expect(stored.previousTokenExpiresAt).toBeNull();
    });

    it('an admin suspend (PATCH isActive false) clears the previous token, so an unsuspend does not revive it', async () => {
      const agent = await makeAgent('suspend');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);
      const newTok: string = res.body.token;
      expect((await auditStatus(agent.token)).status).toBe(200);

      const patch = (body: Record<string, unknown>) =>
        request(app).patch(`/api/agents/${agent.id}`).set('Authorization', bearer(admin.jwt)).send(body);

      // An edit that does not suspend keeps the grace window open.
      expect((await patch({ description: 'still rotating' })).status).toBe(200);
      expect((await row(agent.id)).previousToken).toBe(agent.token);

      expect((await patch({ isActive: false })).status).toBe(200);
      const suspended = await row(agent.id);
      expect(suspended.previousToken).toBeNull();
      expect(suspended.previousTokenExpiresAt).toBeNull();
      expect(suspended.token).toBe(newTok);

      expect((await patch({ isActive: true })).status).toBe(200);
      expect((await auditStatus(agent.token)).status).toBe(401);
      expect((await auditStatus(newTok)).status).toBe(200);
    });

    it('gateway-config carries previousToken and an ISO expiry while the window is open, null after, null if never rotated', async () => {
      const rotated = await makeAgent('cfg-rotated');
      const untouched = await makeAgent('cfg-untouched');
      const res = await rotate(rotated.id, { proof: rotated.token });
      expect(res.status).toBe(200);

      const open = await configEntry(rotated.userId);
      expect(open).toMatchObject({ token: res.body.token, previousToken: rotated.token });
      expect(open!.previousTokenExpiresAt).toBe(res.body.previousTokenExpiresAt);
      expect(new Date(open!.previousTokenExpiresAt as string).toISOString()).toBe(open!.previousTokenExpiresAt);

      const never = await configEntry(untouched.userId);
      expect(never).toMatchObject({ token: untouched.token, previousToken: null, previousTokenExpiresAt: null });

      await expireGrace(rotated.id);
      const closed = await configEntry(rotated.userId);
      expect(closed).toMatchObject({ token: res.body.token, previousToken: null, previousTokenExpiresAt: null });
    });

    it('gateway-config keeps its historical auth behaviour (401/403 messages, no isActive check on the gateway token)', async () => {
      const noHeader = await request(app).get('/api/agents/gateway-config');
      expect(noHeader.status).toBe(401);
      expect(noHeader.body).toEqual({ error: 'Gateway bearer token required' });
      const ordinary = await makeAgent('cfg-ordinary');
      const wrong = await request(app).get('/api/agents/gateway-config').set('Authorization', bearer(ordinary.token));
      expect(wrong.status).toBe(403);
      expect(wrong.body).toEqual({ error: 'Gateway token required' });

      await prisma.agentToken.update({ where: { id: gateway.id }, data: { isActive: false } });
      try {
        const res = await request(app).get('/api/agents/gateway-config').set('Authorization', bearer(gateway.token));
        expect(res.status).toBe(200);
      } finally {
        await prisma.agentToken.update({ where: { id: gateway.id }, data: { isActive: true } });
      }
    });
  });

  // ── restart durability ───────────────────────────────────────────────

  describe('restart durability', () => {
    it('a fresh gateway-config read serves the new token and the old one as previousToken', async () => {
      const agent = await makeAgent('durable');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);

      // A new PrismaClient shares no state with the app's client or any
      // in-process cache: what it reads is what a restarted gateway sync sees.
      const fresh = new PrismaClient();
      try {
        const stored = await fresh.agentToken.findUniqueOrThrow({ where: { id: agent.id } });
        expect(stored.token).toBe(res.body.token);
        expect(stored.previousToken).toBe(agent.token);
      } finally {
        await fresh.$disconnect();
      }
      const entry = await configEntry(agent.userId);
      expect(entry).toMatchObject({ token: res.body.token, previousToken: agent.token });
    });
  });

  // ── audit ────────────────────────────────────────────────────────────

  describe('audit', () => {
    it('logs exactly one rotate event on success and never a token value', async () => {
      const agent = await makeAgent('audit');
      const res = await rotate(agent.id, { proof: agent.token });
      expect(res.status).toBe(200);

      expect(auditSpy).toHaveBeenCalledTimes(1);
      const entry = auditSpy.mock.calls[0][0];
      expect(entry).toMatchObject({
        agentId: agent.userId,
        action: 'agent.token.rotate',
        resourceType: 'agent_token',
        resourceId: agent.id,
      });
      expect(entry.details).toEqual({
        graceSeconds: 300,
        previousTokenExpiresAt: res.body.previousTokenExpiresAt,
      });
      const serialized = JSON.stringify(auditSpy.mock.calls);
      expect(serialized).not.toContain(agent.token);
      expect(serialized).not.toContain(res.body.token);
    });

    it('does not log a rotation for failed attempts (401, 403, 404, 409)', async () => {
      const agent = await makeAgent('auditfail');
      await rotate(agent.id, { gateway: null, proof: agent.token }); // 401
      await rotate(agent.id, { proof: 'byoa_wrong' }); // 403
      await rotate('no-such-agent-id', { proof: agent.token }); // 404
      jest.spyOn(rotationService, 'rotateAgentToken').mockRejectedValue(new rotationService.RotateConflictError());
      const conflict = await rotate(agent.id, { proof: agent.token }); // 409
      expect(conflict.status).toBe(409);

      const rotations = auditSpy.mock.calls.filter((c) => c[0].action === 'agent.token.rotate');
      expect(rotations).toHaveLength(0);
    });
  });

  // ── error path ───────────────────────────────────────────────────────

  describe('unexpected failure', () => {
    it('returns 500 without echoing any token and logs only the error class', async () => {
      const agent = await makeAgent('boom');
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest
        .spyOn(rotationService, 'rotateAgentToken')
        .mockRejectedValue(new Error(`db exploded near ${agent.token}`));

      const res = await rotate(agent.id, { proof: agent.token });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to rotate agent token' });
      // the exact call: a raw Error would serialize to '{}' in JSON.stringify
      // and slip past a string search, so pin the arguments themselves
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('[agents] token rotate error:', 'Error');
      expect(util.inspect(errorSpy.mock.calls, { depth: 6 })).not.toContain(agent.token);
      expect((await row(agent.id)).token).toBe(agent.token);
    });
  });
});
