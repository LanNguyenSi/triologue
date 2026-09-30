/**
 * Admin routes to list, transfer and remove MCP connections (task 18620b53).
 *
 * A user who owns mcp_connections rows is blocked from self-deleting
 * (`DELETE /api/auth/me` answers 409 `owns_mcp_connections`, task eb405d43).
 * These routes let an administrator resolve that in the product:
 *
 *   GET    /api/admin/mcp-connections
 *   PATCH  /api/admin/mcp-connections/:id/owner   { newOwnerId }
 *   DELETE /api/admin/mcp-connections/:id
 *
 * DB-backed integration suite, gated on RUN_DB_TESTS like
 * auth-self-delete-restrict-fks.test.ts.
 *
 * Mutation-testability:
 *   - dropping `requireAdmin` from a route makes the non-admin 403 case
 *     answer 200 (and the connection change), failing the authz tests;
 *   - dropping `requireHuman` makes the admin-flagged agent-token case
 *     answer 200 instead of 403;
 *   - dropping the target's `isAdmin` check makes the non-admin-target case
 *     answer 200 instead of 400;
 *   - reverting the transfer's `createdBy` write leaves the connection with
 *     its old owner, so the follow-up self-delete stays 409.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { callTool } from '../connectors/mcp/mcpBridge';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Username pattern caps at 30 chars; 8 chars of prefix leave 22 for a suffix.
const USERNAME_PREFIX = 'amcp-tst';

async function cleanup() {
  const stale = await prisma.user.findMany({
    where: { username: { startsWith: USERNAME_PREFIX } },
    select: { id: true },
  });
  const ids = stale.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.mcpConnection.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.agentToken.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.agentAuditLog.deleteMany({ where: { agentId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: USERNAME_PREFIX } } });
}

async function registerHuman(suffix: string, opts: { admin?: boolean } = {}) {
  const username = `${USERNAME_PREFIX}-${suffix}`;
  const reg = await request(app).post('/api/auth/register').send({
    username,
    email: `${username}@test.example.com`,
    password: 'Password123',
    displayName: `Admin MCP Test ${suffix}`,
    userType: 'HUMAN',
  });
  expect(reg.status).toBe(201);
  const userId = reg.body.user.id as string;
  if (opts.admin) {
    await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
  }
  return { token: reg.body.token as string, userId };
}

async function createConnection(ownerId: string, name: string) {
  return prisma.mcpConnection.create({
    data: {
      name,
      url: 'https://mcp.example.com/sse',
      apiKey: 'super-secret-key',
      createdBy: ownerId,
    },
  });
}

async function waitForAudit(action: string, resourceId: string) {
  for (let i = 0; i < 40; i += 1) {
    const row = await prisma.agentAuditLog.findFirst({ where: { action, resourceId } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describeOrSkip('admin MCP connection routes (task 18620b53)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('authorization', () => {
    it('answers 401 without a token on every route', async () => {
      const owner = await registerHuman('a401-owner', { admin: true });
      const conn = await createConnection(owner.userId, 'authz 401');

      const list = await request(app).get('/api/admin/mcp-connections');
      const transfer = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .send({ newOwnerId: owner.userId });
      const remove = await request(app).delete(`/api/admin/mcp-connections/${conn.id}`);

      expect([list.status, transfer.status, remove.status]).toEqual([401, 401, 401]);
      expect(await prisma.mcpConnection.findUnique({ where: { id: conn.id } })).not.toBeNull();
    });

    it('answers 403 to a non-admin on every route and changes nothing', async () => {
      const admin = await registerHuman('a403-admin', { admin: true });
      const member = await registerHuman('a403-member');
      const conn = await createConnection(admin.userId, 'authz 403');

      const list = await request(app)
        .get('/api/admin/mcp-connections')
        .set('Authorization', `Bearer ${member.token}`);
      const transfer = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ newOwnerId: admin.userId });
      const selfTransfer = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ newOwnerId: member.userId });
      const remove = await request(app)
        .delete(`/api/admin/mcp-connections/${conn.id}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect([list.status, transfer.status, selfTransfer.status, remove.status]).toEqual([
        403, 403, 403, 403,
      ]);
      const after = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(after).not.toBeNull();
      expect(after!.createdBy).toBe(admin.userId);
    });

    it('answers 403 to an admin-flagged agent token (human admins only)', async () => {
      const admin = await registerHuman('a403-agtadm', { admin: true });
      const agentUser = await prisma.user.create({
        data: {
          username: `${USERNAME_PREFIX}-agt-admin`,
          displayName: 'Admin MCP Test Agent',
          userType: 'AI_AGENT',
          isActive: true,
          isAdmin: true,
        },
      });
      const agentToken = `byoa_${crypto.randomBytes(16).toString('hex')}`;
      await prisma.agentToken.create({
        data: {
          token: agentToken,
          name: 'Admin MCP Test Agent',
          mentionKey: `amcp-agt-${Date.now().toString(36)}`,
          userId: agentUser.id,
          createdById: admin.userId,
          status: 'active',
          isActive: true,
        },
      });
      const conn = await createConnection(admin.userId, 'authz agent');

      const remove = await request(app)
        .delete(`/api/admin/mcp-connections/${conn.id}`)
        .set('Authorization', `Bearer ${agentToken}`);
      const list = await request(app)
        .get('/api/admin/mcp-connections')
        .set('Authorization', `Bearer ${agentToken}`);

      expect([remove.status, list.status]).toEqual([403, 403]);
      expect(await prisma.mcpConnection.findUnique({ where: { id: conn.id } })).not.toBeNull();
    });
  });

  describe('GET /api/admin/mcp-connections', () => {
    it('lists connections with their owner and never returns the api key', async () => {
      const admin = await registerHuman('list-admin', { admin: true });
      const owner = await registerHuman('list-owner');
      const conn = await createConnection(owner.userId, 'list me');

      const res = await request(app)
        .get('/api/admin/mcp-connections')
        .query({ ownerId: owner.userId })
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.connections).toHaveLength(1);
      expect(res.body.connections[0]).toMatchObject({
        id: conn.id,
        name: 'list me',
        createdBy: owner.userId,
        creator: { id: owner.userId, isAdmin: false },
      });
      expect(JSON.stringify(res.body)).not.toContain('super-secret-key');
      expect(res.body.connections[0]).not.toHaveProperty('apiKey');
    });
  });

  describe('PATCH /api/admin/mcp-connections/:id/owner', () => {
    it('transfers to another admin, returns the new owner and writes an audit row', async () => {
      const actor = await registerHuman('tr-actor', { admin: true });
      const target = await registerHuman('tr-target', { admin: true });
      const conn = await createConnection(actor.userId, 'transfer ok');

      const res = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: target.userId });

      expect(res.status).toBe(200);
      expect(res.body.connection.createdBy).toBe(target.userId);
      expect(JSON.stringify(res.body)).not.toContain('super-secret-key');
      const after = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(after!.createdBy).toBe(target.userId);

      const audit = await waitForAudit('mcp_connection.owner.transferred', conn.id);
      expect(audit).not.toBeNull();
      expect(audit!.agentId).toBe(actor.userId);
      expect(audit!.details).toMatchObject({
        fromUserId: actor.userId,
        toUserId: target.userId,
        previousOwnerWasAdmin: true,
      });
    });

    it('rejects a non-admin target with 400 and leaves the owner unchanged', async () => {
      const actor = await registerHuman('tr-nadm-actor', { admin: true });
      const nonAdmin = await registerHuman('tr-nadm-target');
      const conn = await createConnection(actor.userId, 'transfer non-admin');

      const res = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: nonAdmin.userId });

      expect(res.status).toBe(400);
      const after = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(after!.createdBy).toBe(actor.userId);
    });

    it('rejects an admin-flagged agent user as the target with 400', async () => {
      const actor = await registerHuman('tr-agt-actor', { admin: true });
      const agentUser = await prisma.user.create({
        data: {
          username: `${USERNAME_PREFIX}-tr-agent`,
          displayName: 'Admin MCP Test Target Agent',
          userType: 'AI_AGENT',
          isActive: true,
          isAdmin: true,
        },
      });
      const conn = await createConnection(actor.userId, 'transfer agent');

      const res = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: agentUser.id });

      expect(res.status).toBe(400);
      const after = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(after!.createdBy).toBe(actor.userId);
    });

    it('rejects an inactive admin target with 400', async () => {
      const actor = await registerHuman('tr-inact-actor', { admin: true });
      const target = await registerHuman('tr-inact-target', { admin: true });
      await prisma.user.update({ where: { id: target.userId }, data: { isActive: false } });
      const conn = await createConnection(actor.userId, 'transfer inactive');

      const res = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: target.userId });

      expect(res.status).toBe(400);
    });

    it('answers 404 for a nonexistent target and for a nonexistent connection', async () => {
      const actor = await registerHuman('tr-404-actor', { admin: true });
      const conn = await createConnection(actor.userId, 'transfer 404');

      const noTarget = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: 'no-such-user-id' });
      const noConnection = await request(app)
        .patch('/api/admin/mcp-connections/no-such-connection/owner')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: actor.userId });

      expect(noTarget.status).toBe(404);
      expect(noConnection.status).toBe(404);
      const after = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(after!.createdBy).toBe(actor.userId);
    });

    it('answers 400 for a missing or non-string newOwnerId and for a transfer to the current owner', async () => {
      const actor = await registerHuman('tr-400-actor', { admin: true });
      const conn = await createConnection(actor.userId, 'transfer 400');

      const missing = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({});
      const wrongType = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: { id: actor.userId } });
      const sameOwner = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ newOwnerId: actor.userId });

      expect([missing.status, wrongType.status, sameOwner.status]).toEqual([400, 400, 400]);
    });
  });

  describe('DELETE /api/admin/mcp-connections/:id', () => {
    it('removes the connection, audits it, and the bridge fails closed for the removed id', async () => {
      const admin = await registerHuman('rm-admin', { admin: true });
      const conn = await createConnection(admin.userId, 'remove me');

      const res = await request(app)
        .delete(`/api/admin/mcp-connections/${conn.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(await prisma.mcpConnection.findUnique({ where: { id: conn.id } })).toBeNull();

      const audit = await waitForAudit('mcp_connection.removed', conn.id);
      expect(audit).not.toBeNull();
      expect(audit!.details).toMatchObject({ name: 'remove me', ownerId: admin.userId });

      // A bridge call for the removed id answers "not found" instead of throwing.
      const call = await callTool(conn.id, 'any-tool', {});
      expect(call).toMatchObject({ success: false, error: 'MCP connection not found' });
    });

    it('answers 404 for a nonexistent connection', async () => {
      const admin = await registerHuman('rm-404-admin', { admin: true });

      const res = await request(app)
        .delete('/api/admin/mcp-connections/no-such-connection')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('end to end with DELETE /api/auth/me', () => {
    it('owner gets 409 owns_mcp_connections, an admin transfers the connection, then self-delete returns 200', async () => {
      const owner = await registerHuman('e2e-owner', { admin: true });
      const successor = await registerHuman('e2e-successor', { admin: true });
      const conn = await createConnection(owner.userId, 'e2e transfer');

      const blocked = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Password123' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('owns_mcp_connections');

      const transfer = await request(app)
        .patch(`/api/admin/mcp-connections/${conn.id}/owner`)
        .set('Authorization', `Bearer ${successor.token}`)
        .send({ newOwnerId: successor.userId });
      expect(transfer.status).toBe(200);

      const deleted = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Password123' });
      expect(deleted.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: owner.userId } })).toBeNull();

      // The connection survives, now owned by the successor.
      const kept = await prisma.mcpConnection.findUnique({ where: { id: conn.id } });
      expect(kept).not.toBeNull();
      expect(kept!.createdBy).toBe(successor.userId);
    });

    it('a non-admin owner gets 409 too, and an admin removing the connection unblocks self-delete', async () => {
      const owner = await registerHuman('e2e-nadm-owner');
      const admin = await registerHuman('e2e-nadm-admin', { admin: true });
      const conn = await createConnection(owner.userId, 'e2e remove');

      const blocked = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Password123' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('owns_mcp_connections');

      const removed = await request(app)
        .delete(`/api/admin/mcp-connections/${conn.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(removed.status).toBe(200);

      const deleted = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'Password123' });
      expect(deleted.status).toBe(200);
    });
  });
});
