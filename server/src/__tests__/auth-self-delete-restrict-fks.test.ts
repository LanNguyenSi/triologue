/**
 * Regression tests for triologue task eb405d43: DELETE /api/auth/me
 * returned 409 ("Account could not be deleted because related data still
 * references it.", Prisma P2003) for any user who exercised one of six
 * RESTRICT foreign keys to `users` that survived task 6bc2a14c's
 * agent_audit_log fix:
 *
 *   - invite_codes.createdById         (covered by auth-self-delete.test.ts,
 *                                        the "deletes an unused invite code
 *                                        ..." and "deactivates a multi-use
 *                                        invite code ..." tests -- not
 *                                        repeated here)
 *   - agent_tokens.createdById
 *   - integration_tokens.createdBy
 *   - connector_permissions.userId
 *   - mcp_connections.createdBy
 *   - approval_request.requestedBy
 *
 * Fix, per relation (routes/auth.ts's DELETE /me batch `$transaction([...])`):
 *   - agent_tokens, integration_tokens and connector_permissions created by
 *     / belonging to the deleting user are DELETED outright (credential-
 *     like: never left valid without an owner). integration_tokens matches
 *     EITHER createdBy OR userId, so a token another user created but
 *     assigned to this user is deleted too, instead of surviving tenant-
 *     wide with userId nulled. These three FKs stay RESTRICT in the schema
 *     -- the offending rows are gone before `prisma.user.delete` runs, so
 *     the constraint is never exercised, no migration needed for them (see
 *     the route's own comment).
 *   - the agent's own User row for every agent_tokens row the deleting user
 *     registered (createdById) is set isActive: false in the same
 *     transaction, on top of deleting its token.
 *   - mcp_connections created by the deleting user are left untouched:
 *     DELETE /me returns 409 with a dedicated `owns_mcp_connections` code
 *     while any exist, instead of deleting them, since an admin-owned,
 *     org-wide connection would otherwise be destroyed for everyone. This
 *     FK also stays RESTRICT; the 409 comes from the constraint itself,
 *     classified specially in the route's catch block.
 *   - approval_request: a still-PENDING request from the deleting user is
 *     deleted; a DECIDED (approved/rejected) one survives with
 *     `requestedBy` nulled by a new `onDelete: SetNull` FK (migration
 *     20260923094230_self_delete_restrict_fks_invite_and_approval) -- it is
 *     the audit record of who decided it, not a live credential.
 *
 * Consequence documented for the reviewer (not asserted by a test, since it
 * is a property of the AGENT's account, not the deleting registrar's):
 * deleting every agent_token row a user registered (`createdById`) also
 * revokes the bearer token of any BYOA agent that user registered, even one
 * with `visibility: "shared"` still in active use by other users in a
 * shared project -- the agent's own `User` row (userId, onDelete: Cascade,
 * unrelated to createdById) survives, deactivated, but with no token it can
 * no longer authenticate. See this task's evidence file for the full
 * analysis, including which of these branches (approval_request,
 * connector_permissions) are reachable for a HUMAN self-delete versus only
 * ever populated with agent ids in this product's current code.
 *
 * This is a DB-backed integration suite, gated on RUN_DB_TESTS like
 * auth-self-delete.test.ts, auth.test.ts and reviewer-inbox.test.ts.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { getToken } from '../services/tokenManager';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Username pattern caps at 30 chars (utils/validation.ts patterns.username);
// this prefix (8 chars) leaves 22 for a `-<suffix>` per test.
const USERNAME_PREFIX = 'sdfk-tst';

async function cleanupUsers() {
  const staleUsers = await prisma.user.findMany({
    where: { username: { startsWith: USERNAME_PREFIX } },
    select: { id: true },
  });
  const ids = staleUsers.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.approvalRequest.deleteMany({ where: { requestedBy: { in: ids } } });
    await prisma.connectorPermission.deleteMany({ where: { userId: { in: ids } } });
    await prisma.mcpConnection.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.integrationToken.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.agentToken.deleteMany({ where: { createdById: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: USERNAME_PREFIX } } });
}

async function registerHuman(suffix: string) {
  const username = `${USERNAME_PREFIX}-${suffix}`;
  const reg = await request(app).post('/api/auth/register').send({
    username,
    email: `${username}@test.example.com`,
    password: 'Password123',
    displayName: `Self Delete FK Test ${suffix}`,
    userType: 'HUMAN',
  });
  expect(reg.status).toBe(201);
  return { token: reg.body.token as string, userId: reg.body.user.id as string };
}

describeOrSkip('DELETE /api/auth/me with remaining RESTRICT-FK rows (task eb405d43)', () => {
  beforeAll(cleanupUsers);
  afterAll(async () => {
    await cleanupUsers();
    await prisma.$disconnect();
  });

  // Mutation-testability: reverting the route's
  // `prisma.agentToken.deleteMany({ where: { createdById: userId } })` to a
  // no-op (or removing it from the `$transaction` array) makes `delRes`
  // 409/P2003 instead of 200, and the token row would still exist.
  it('deletes agent_tokens the user registered (createdById), token-class, on self-delete, and deactivates the agent User row', async () => {
    const registrar = await registerHuman('agtok-registrar');
    const agentUser = await prisma.user.create({
      data: {
        username: `${USERNAME_PREFIX}-agtok-agent`,
        displayName: 'Self Delete FK Test Agent',
        userType: 'AI_AGENT',
        isActive: true,
      },
    });
    const token = await prisma.agentToken.create({
      data: {
        token: `byoa_${crypto.randomBytes(16).toString('hex')}`,
        name: 'Self Delete FK Test Agent',
        mentionKey: `sdfk-agtok-${Date.now().toString(36)}`,
        userId: agentUser.id,
        createdById: registrar.userId,
        status: 'active',
        isActive: true,
      },
    });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${registrar.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const registrarAfter = await prisma.user.findUnique({ where: { id: registrar.userId } });
    expect(registrarAfter).toBeNull();

    const tokenAfter = await prisma.agentToken.findUnique({ where: { id: token.id } });
    expect(tokenAfter).toBeNull();

    // Mutation-testability (D-011): reverting the route's raw
    // `UPDATE "users" SET "isActive" = false WHERE id IN (...)` statement to
    // a no-op leaves this row isActive: true, failing the assertion below.
    // The agent's own account survives (only the registrar was deleted),
    // deactivated, since it has no token left to authenticate with either
    // way, but stays visible in every room/permission it was already in.
    const agentUserAfter = await prisma.user.findUnique({ where: { id: agentUser.id } });
    expect(agentUserAfter).not.toBeNull();
    expect(agentUserAfter!.isActive).toBe(false);

    // A login attempt with the (now-deleted) token is rejected, regardless
    // of the isActive flag above: the token row itself is gone.
    const loginRes = await request(app).post('/api/auth/login').send({
      username: agentUser.username,
      userType: 'AI_AGENT',
      aiToken: token.token,
    });
    expect(loginRes.status).toBe(401);

    await prisma.user.deleteMany({ where: { id: agentUser.id } });
  });

  // Mutation-testability: reverting the route's
  // `prisma.integrationToken.deleteMany({ where: { createdBy: userId } })`
  // to a no-op makes `delRes` 409/P2003 instead of 200.
  it('deletes integration_tokens the user created (createdBy), token-class, on self-delete', async () => {
    const creator = await registerHuman('inttok-creator');
    const token = await prisma.integrationToken.create({
      data: {
        provider: 'jira',
        scope: 'read',
        accessToken: 'encrypted-access-token',
        expiresAt: new Date(Date.now() + 3600_000),
        createdBy: creator.userId,
      },
    });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const tokenAfter = await prisma.integrationToken.findUnique({ where: { id: token.id } });
    expect(tokenAfter).toBeNull();
  });

  // Pre-existing bug this OR-condition fixes (review r1, finding 4):
  // integration_tokens.userId has onDelete: SetNull (unlike createdBy,
  // which stays RESTRICT); a token OWNED by this user (userId) but CREATED
  // by someone else did not match the old `{ createdBy: userId }` filter,
  // so it survived user.delete with userId nulled by that FK -- silently
  // turning a per-user token into a tenant-wide one, since
  // tokenManager.getToken() looks up `userId: null`.
  //
  // Mutation-testability: reverting the route's OR condition back to
  // `{ createdBy: userId }` only leaves this row present (userId null)
  // instead of deleted, failing the first assertion below; `getToken` would
  // then also return the decrypted secret instead of null.
  it('deletes integration_tokens owned by the user (userId) but created by someone else, instead of leaving them tenant-wide', async () => {
    const owner = await registerHuman('inttok-owner');
    const otherCreator = await registerHuman('inttok-other');
    const token = await prisma.integrationToken.create({
      data: {
        provider: 'jira',
        scope: 'read',
        accessToken: 'encrypted-access-token',
        expiresAt: new Date(Date.now() + 3600_000),
        createdBy: otherCreator.userId,
        userId: owner.userId,
      },
    });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const tokenAfter = await prisma.integrationToken.findUnique({ where: { id: token.id } });
    expect(tokenAfter).toBeNull();

    const tenantWide = await getToken('jira', 'read');
    expect(tenantWide).toBeNull();

    const delOtherRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${otherCreator.token}`)
      .send({ password: 'Password123' });
    expect(delOtherRes.status).toBe(200);
  });

  // Mutation-testability: reverting the route's
  // `prisma.connectorPermission.deleteMany({ where: { userId } })` to a
  // no-op makes `delRes` 409/P2003 instead of 200.
  it('deletes connector_permissions of the user (userId), token-class, on self-delete', async () => {
    const grantee = await registerHuman('connperm-grantee');
    const permission = await prisma.connectorPermission.create({
      data: {
        connectorId: 'jira',
        userId: grantee.userId,
        allowedActions: ['read'],
        grantedBy: grantee.userId,
      },
    });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${grantee.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const permissionAfter = await prisma.connectorPermission.findUnique({
      where: { id: permission.id },
    });
    expect(permissionAfter).toBeNull();
  });

  // D-010 (review r1, finding 3): mcp_connections used to be deleted like
  // the other three credential-class relations, but an mcp_connections row
  // can be admin-owned and org-wide (seed.ts, visible to every agent), so
  // deleting it on that admin's self-delete destroyed it for everyone. The
  // route now returns 409 with `owns_mcp_connections` instead, and does not
  // touch mcp_connections at all; the pre-existing RESTRICT FK on
  // mcp_connections.createdBy is what actually blocks `prisma.user.delete`
  // below, classified in the route's catch block.
  //
  // Mutation-testability: reverting the route's `owns_mcp_connections`
  // classification to fall through to the generic 409 branch leaves
  // `delRes.body.code` as `'P2003'` instead of `'owns_mcp_connections'`,
  // failing that assertion while `delRes.status` still passes; re-adding
  // the removed `mcpConnection.deleteMany` makes the first `delRes.status`
  // assertion fail (200 instead of 409) and the connection row would be
  // gone instead of present.
  it('returns 409 owns_mcp_connections while the user owns an mcp_connections row, deletes nothing, then 200 once it is removed', async () => {
    const creator = await registerHuman('mcpconn-creator');
    const connection = await prisma.mcpConnection.create({
      data: {
        name: 'Self Delete FK Test MCP',
        url: 'https://mcp.example.com/sse',
        createdBy: creator.userId,
      },
    });

    const blockedRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ password: 'Password123' });
    expect(blockedRes.status).toBe(409);
    expect(blockedRes.body.code).toBe('owns_mcp_connections');

    const userStillPresent = await prisma.user.findUnique({ where: { id: creator.userId } });
    expect(userStillPresent).not.toBeNull();
    const connectionStillPresent = await prisma.mcpConnection.findUnique({ where: { id: connection.id } });
    expect(connectionStillPresent).not.toBeNull();

    // Transfer/remove: once the connection is gone, self-delete succeeds.
    await prisma.mcpConnection.delete({ where: { id: connection.id } });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const userAfter = await prisma.user.findUnique({ where: { id: creator.userId } });
    expect(userAfter).toBeNull();
  });

  // Mutation-testability: reverting the route's
  // `prisma.approvalRequest.deleteMany({ where: { requestedBy: userId,
  // status: 'pending' } })` to a no-op makes `delRes` 409/P2003 instead of
  // 200 for THIS sub-case (the pending row is what still blocks); reverting
  // the schema's `onDelete: SetNull` back to the default RESTRICT (or
  // scoping the deleteMany without the `status: 'pending'` filter, so it
  // also deletes decided rows) fails the second sub-case's
  // "decided request survives, requestedBy nulled" assertions instead.
  it('deletes a pending approval_request from the user, and SetNulls requestedBy on a decided one', async () => {
    const requester = await registerHuman('appr-requester');
    const pending = await prisma.approvalRequest.create({
      data: {
        requestedBy: requester.userId,
        connectorId: 'jira',
        actionId: 'create-issue',
        status: 'pending',
      },
    });
    const decided = await prisma.approvalRequest.create({
      data: {
        requestedBy: requester.userId,
        connectorId: 'jira',
        actionId: 'create-issue',
        status: 'approved',
        decidedAt: new Date(),
      },
    });

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${requester.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const requesterAfter = await prisma.user.findUnique({ where: { id: requester.userId } });
    expect(requesterAfter).toBeNull();

    const pendingAfter = await prisma.approvalRequest.findUnique({ where: { id: pending.id } });
    expect(pendingAfter).toBeNull();

    const decidedAfter = await prisma.approvalRequest.findUnique({ where: { id: decided.id } });
    expect(decidedAfter).not.toBeNull();
    expect(decidedAfter!.requestedBy).toBeNull();
    expect(decidedAfter!.status).toBe('approved');
  });

  // The tracker task's own repro: "a project owner who invited someone by
  // email (POST /api/projects/:id/team/invite creates an InviteCode with
  // createdById = owner) gets 409 from DELETE /me at head of 6bc2a14c's
  // branch". `createOneTimeInviteCode` (routes/projects.ts) creates the row
  // with `usedById` unset (nobody has redeemed it yet), so it is the
  // "unused" sub-case the route's new `inviteCode.deleteMany({ where: {
  // createdById: userId, usedById: null } })` closes.
  it('returns 200 for the inviter repro: an unused email-invite created via POST /:id/team/invite no longer blocks self-delete', async () => {
    const owner = await registerHuman('inviter-repro');
    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Inviter Repro Project' });
    expect(projectRes.status).toBe(201);

    const inviteRes = await request(app)
      .post(`/api/projects/${projectRes.body.id}/team/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: `invitee-${Date.now()}@test.example.com` });
    expect(inviteRes.status).toBe(200);

    const inviteBefore = await prisma.inviteCode.findFirst({
      where: { createdById: owner.userId },
    });
    expect(inviteBefore).not.toBeNull();
    expect(inviteBefore!.usedById).toBeNull();

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const ownerAfter = await prisma.user.findUnique({ where: { id: owner.userId } });
    expect(ownerAfter).toBeNull();

    const inviteAfter = await prisma.inviteCode.findUnique({ where: { id: inviteBefore!.id } });
    expect(inviteAfter).toBeNull();
  });
});
