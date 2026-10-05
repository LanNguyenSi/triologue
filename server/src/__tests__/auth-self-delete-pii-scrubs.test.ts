/**
 * DB-backed tests for the personal-data scrubs DELETE /api/auth/me runs in
 * the same transaction as the user delete, for columns that hold the deleted
 * user's id or text with no foreign key (or whose SetNull would leave the
 * text behind), plus the best-effort mention-limits cleanup after commit.
 * The complete list of what is kept lives in
 * docs/okf/self-delete-data-retention.md.
 *
 * Every test seeds a fixture for the deleting user (A) AND a control row of
 * the same shape that belongs to other users (B, C), deletes A through the
 * real route, and asserts both: A's reference is gone, the control row is
 * byte-for-byte unchanged. The rollback proof (every new statement is
 * undone when a later statement fails) lives in auth-self-delete.test.ts's
 * rollback test.
 *
 * Mutation-testability: dropping any one scrub statement from the route's
 * `$transaction([...])` array is killed by the test named after it; moving
 * the usedById scrub above the invite note scrub is killed by the note
 * test (the redeemed half of the note scrub matches on usedById); keying
 * the unused-invite-code deleteMany on usedById instead of useCount is
 * killed by the chained self-delete test; widening the note scrub's
 * redeemed half to multi-use codes is killed by the multi-use note
 * assertion; removing the post-commit mention-limits call, calling it
 * before the transaction, or letting its failure fail the request are
 * killed by the last three tests.
 */
import crypto from 'crypto';
import request from './helpers/loopbackRequest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import appPrisma from '../lib/prisma';
import { logger } from '../utils/logger';
import * as mentionLimiter from '../services/mentionLimiter';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const PREFIX = 'sdpii';
const PASSWORD = 'Password123';

interface Ctx {
  a: { id: string; token: string; email: string };
  b: { id: string };
  c: { id: string };
  projectIds: string[];
  inviteIds: string[];
  approvalIds: string[];
  agentTokenIds: string[];
  agentUserIds: string[];
}

let ctx: Ctx;
let seq = 0;

function uniq(label: string) {
  seq += 1;
  return `${PREFIX}-${label}-${Date.now().toString(36)}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: { username: uniq(label), displayName: `PII ${label}`, userType: 'HUMAN' },
  });
}

async function setup(): Promise<Ctx> {
  const username = uniq('a');
  const email = `${username}@test.example.com`;
  const reg = await request(app).post('/api/auth/register').send({
    username,
    email,
    password: PASSWORD,
    displayName: 'PII A',
    userType: 'HUMAN',
  });
  expect(reg.status).toBe(201);
  const b = await makeUser('b');
  const c = await makeUser('c');
  return {
    a: { id: reg.body.user.id as string, token: reg.body.token as string, email },
    b: { id: b.id },
    c: { id: c.id },
    projectIds: [],
    inviteIds: [],
    approvalIds: [],
    agentTokenIds: [],
    agentUserIds: [],
  };
}

async function teardown(c: Ctx) {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['approvals', () => prisma.approvalRequest.deleteMany({ where: { id: { in: c.approvalIds } } })],
    ['agent tokens', () => prisma.agentToken.deleteMany({ where: { id: { in: c.agentTokenIds } } })],
    ['agent users', () => prisma.user.deleteMany({ where: { id: { in: c.agentUserIds } } })],
    ['invites', () => prisma.inviteCode.deleteMany({ where: { id: { in: c.inviteIds } } })],
    ['projects', () => prisma.project.deleteMany({ where: { id: { in: c.projectIds } } })],
    ['inbox', () => prisma.inboxItem.deleteMany({ where: { recipientId: { in: [c.a.id, c.b.id, c.c.id] } } })],
    ['users', () => prisma.user.deleteMany({ where: { id: { in: [c.a.id, c.b.id, c.c.id] } } })],
  ];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`pii-scrubs test cleanup step failed (${label}):`, err);
    }
  }
}

async function deleteA(c: Ctx) {
  const res = await request(app)
    .delete('/api/auth/me')
    .set('Authorization', `Bearer ${c.a.token}`)
    .send({ password: PASSWORD });
  expect(res.status).toBe(200);
  expect(await prisma.user.findUnique({ where: { id: c.a.id } })).toBeNull();
}

async function makeInvite(
  c: Ctx,
  data: {
    createdById: string;
    usedById?: string;
    note?: string;
    maxUses?: number;
  },
) {
  const row = await prisma.inviteCode.create({
    data: {
      code: `PII-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      createdById: data.createdById,
      usedById: data.usedById ?? null,
      usedAt: data.usedById ? new Date() : null,
      useCount: data.usedById ? 1 : 0,
      maxUses: data.maxUses ?? 1,
      note: data.note ?? null,
    },
  });
  c.inviteIds.push(row.id);
  return row;
}

async function makeProject(c: Ctx, ownerId: string, teamMemberIds: string[]) {
  const row = await prisma.project.create({
    data: { name: uniq('proj'), ownerId, teamMemberIds },
  });
  c.projectIds.push(row.id);
  return row;
}

async function makeAgentToken(c: Ctx, createdById: string, sharedWith: string[]) {
  const agentUser = await prisma.user.create({
    data: { username: uniq('agent'), displayName: 'PII Agent', userType: 'AI_AGENT', isActive: true },
  });
  c.agentUserIds.push(agentUser.id);
  const row = await prisma.agentToken.create({
    data: {
      token: `byoa_${crypto.randomBytes(16).toString('hex')}`,
      name: 'PII Agent',
      mentionKey: uniq('mk'),
      userId: agentUser.id,
      createdById,
      status: 'active',
      isActive: true,
      visibility: 'shared',
      sharedWith,
    },
  });
  c.agentTokenIds.push(row.id);
  return row;
}

describeOrSkip('DELETE /api/auth/me personal-data scrubs', () => {
  let limiterSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Keep the real data/mention-limits.json out of these tests; the
    // helper itself is covered by mentionLimiter-removal.test.ts and the
    // last three tests below assert the route's use of it.
    limiterSpy = jest.spyOn(mentionLimiter, 'removeMentionLimitEntry').mockResolvedValue(false);
    ctx = await setup();
  });

  afterEach(async () => {
    limiterSpy.mockRestore();
    await teardown(ctx);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('nulls invite_codes.usedById on codes this user redeemed, keeps the codes, and leaves other redeemers alone', async () => {
    const redeemedByA = await makeInvite(ctx, { createdById: ctx.b.id, usedById: ctx.a.id });
    const controlRedeemedByC = await makeInvite(ctx, { createdById: ctx.b.id, usedById: ctx.c.id });
    // Created AND redeemed by A: must survive (used codes are kept). Which
    // codes count as used is decided by useCount, so this does not depend on
    // the order of the usedById scrub relative to the unused-code delete.
    const selfRedeemed = await makeInvite(ctx, { createdById: ctx.a.id, usedById: ctx.a.id });
    // Created by A, redeemed by B: keeps B as redeemer, loses A as creator.
    const createdByAUsedByB = await makeInvite(ctx, { createdById: ctx.a.id, usedById: ctx.b.id });
    const unusedCreatedByA = await makeInvite(ctx, { createdById: ctx.a.id });

    await deleteA(ctx);

    const r1 = await prisma.inviteCode.findUnique({ where: { id: redeemedByA.id } });
    expect(r1).not.toBeNull();
    expect(r1!.usedById).toBeNull();
    expect(r1!.useCount).toBe(1);
    expect(r1!.createdById).toBe(ctx.b.id);

    const control = await prisma.inviteCode.findUnique({ where: { id: controlRedeemedByC.id } });
    expect(control).toEqual(controlRedeemedByC);

    const self = await prisma.inviteCode.findUnique({ where: { id: selfRedeemed.id } });
    expect(self).not.toBeNull();
    expect(self!.usedById).toBeNull();
    expect(self!.createdById).toBeNull();
    expect(self!.isActive).toBe(false);

    const byB = await prisma.inviteCode.findUnique({ where: { id: createdByAUsedByB.id } });
    expect(byB!.usedById).toBe(ctx.b.id);
    expect(byB!.createdById).toBeNull();

    expect(await prisma.inviteCode.findUnique({ where: { id: unusedCreatedByA.id } })).toBeNull();
  });

  it('nulls invite_codes.note on single-use codes this user redeemed and on used codes this user created, and keeps other notes', async () => {
    const redeemedByA = await makeInvite(ctx, {
      createdById: ctx.b.id,
      usedById: ctx.a.id,
      note: `for ${ctx.a.email}`,
    });
    const createdByAUsedByB = await makeInvite(ctx, {
      createdById: ctx.a.id,
      usedById: ctx.b.id,
      note: 'invitee someone@example.com',
    });
    const controlRedeemedByC = await makeInvite(ctx, {
      createdById: ctx.b.id,
      usedById: ctx.c.id,
      note: 'keep this note',
    });
    // Documented keep: a multi-use code another user created that this user
    // only redeemed. The note is the creator's label for the whole code, and
    // the code stays active for later redeemers; only usedById is nulled.
    const multiUseRedeemedByA = await makeInvite(ctx, {
      createdById: ctx.b.id,
      usedById: ctx.a.id,
      maxUses: 5,
      note: `project:team|for ${ctx.a.email}`,
    });
    // The single-use boundary: a two-use code is already multi-use, so its
    // note is kept as well.
    const twoUseRedeemedByA = await makeInvite(ctx, {
      createdById: ctx.b.id,
      usedById: ctx.a.id,
      maxUses: 2,
      note: `for ${ctx.a.email}`,
    });
    // Documented keep: an UNUSED code another user created whose free-text
    // note merely mentions this user's email is not matched.
    const unusedMentioningA = await makeInvite(ctx, {
      createdById: ctx.b.id,
      note: `for ${ctx.a.email}`,
    });

    await deleteA(ctx);

    expect((await prisma.inviteCode.findUnique({ where: { id: redeemedByA.id } }))!.note).toBeNull();
    expect((await prisma.inviteCode.findUnique({ where: { id: createdByAUsedByB.id } }))!.note).toBeNull();
    expect(await prisma.inviteCode.findUnique({ where: { id: controlRedeemedByC.id } })).toEqual(
      controlRedeemedByC,
    );
    const multiAfter = await prisma.inviteCode.findUnique({ where: { id: multiUseRedeemedByA.id } });
    expect(multiAfter!.note).toBe(multiUseRedeemedByA.note);
    expect(multiAfter!.isActive).toBe(true);
    expect(multiAfter!.usedById).toBeNull();
    expect(multiAfter!.createdById).toBe(ctx.b.id);
    const twoUseAfter = await prisma.inviteCode.findUnique({ where: { id: twoUseRedeemedByA.id } });
    expect(twoUseAfter!.note).toBe(twoUseRedeemedByA.note);
    expect(twoUseAfter!.usedById).toBeNull();
    expect(await prisma.inviteCode.findUnique({ where: { id: unusedMentioningA.id } })).toEqual(
      unusedMentioningA,
    );
  });

  it('nulls approval_request.decidedBy and decisionNote for decisions this user made, keeping the row, status and decidedAt', async () => {
    const decidedAt = new Date('2026-01-02T03:04:05.000Z');
    const decidedByA = await prisma.approvalRequest.create({
      data: {
        requestedBy: ctx.b.id,
        connectorId: 'jira',
        actionId: 'create-issue',
        status: 'approved',
        decidedBy: ctx.a.id,
        decisionNote: 'approved, mail me at a@example.com',
        decidedAt,
      },
    });
    const decidedByC = await prisma.approvalRequest.create({
      data: {
        requestedBy: ctx.b.id,
        connectorId: 'jira',
        actionId: 'create-issue',
        status: 'rejected',
        decidedBy: ctx.c.id,
        decisionNote: 'keep this note',
        decidedAt,
      },
    });
    ctx.approvalIds.push(decidedByA.id, decidedByC.id);

    await deleteA(ctx);

    const after = await prisma.approvalRequest.findUnique({ where: { id: decidedByA.id } });
    expect(after).not.toBeNull();
    expect(after!.decidedBy).toBeNull();
    expect(after!.decisionNote).toBeNull();
    expect(after!.status).toBe('approved');
    expect(after!.decidedAt).toEqual(decidedAt);
    expect(after!.requestedBy).toBe(ctx.b.id);

    expect(await prisma.approvalRequest.findUnique({ where: { id: decidedByC.id } })).toEqual(decidedByC);
  });

  it("nulls tasks.reviewedBy on other owners' tasks that name this user, and leaves other reviewers alone", async () => {
    const project = await makeProject(ctx, ctx.b.id, [ctx.a.id, ctx.c.id]);
    const base = { projectId: project.id, createdBy: ctx.b.id, assignedTo: ctx.b.id };
    const reviewedByA = await prisma.task.create({ data: { ...base, title: 'r-a', reviewedBy: ctx.a.id } });
    const reviewedByC = await prisma.task.create({ data: { ...base, title: 'r-c', reviewedBy: ctx.c.id } });
    const noReviewer = await prisma.task.create({ data: { ...base, title: 'r-none' } });

    await deleteA(ctx);

    const after = await prisma.task.findUnique({ where: { id: reviewedByA.id } });
    expect(after).not.toBeNull();
    expect(after!.reviewedBy).toBeNull();
    expect(after!.title).toBe('r-a');
    expect((await prisma.task.findUnique({ where: { id: reviewedByC.id } }))!.reviewedBy).toBe(ctx.c.id);
    expect((await prisma.task.findUnique({ where: { id: noReviewer.id } }))!.reviewedBy).toBeNull();
  });

  it("removes this user's id from other owners' projects.teamMemberIds and leaves every other id and project alone", async () => {
    const withA = await makeProject(ctx, ctx.b.id, [ctx.a.id, ctx.c.id, ctx.b.id]);
    const withoutA = await makeProject(ctx, ctx.b.id, [ctx.c.id]);
    const empty = await makeProject(ctx, ctx.c.id, []);
    const repeated = await makeProject(ctx, ctx.b.id, [ctx.a.id, ctx.c.id, ctx.a.id, ctx.b.id, ctx.a.id]);

    await deleteA(ctx);

    const after = await prisma.project.findUnique({ where: { id: withA.id } });
    expect(after).not.toBeNull();
    expect(after!.teamMemberIds).toEqual([ctx.c.id, ctx.b.id]);
    expect((await prisma.project.findUnique({ where: { id: withoutA.id } }))!.teamMemberIds).toEqual([ctx.c.id]);
    expect((await prisma.project.findUnique({ where: { id: empty.id } }))!.teamMemberIds).toEqual([]);
    // An id present more than once is removed everywhere, not just once.
    expect((await prisma.project.findUnique({ where: { id: repeated.id } }))!.teamMemberIds).toEqual([
      ctx.c.id,
      ctx.b.id,
    ]);
  });

  it("removes this user's id from other owners' agent_tokens.sharedWith and leaves every other id and token alone", async () => {
    const sharedWithA = await makeAgentToken(ctx, ctx.b.id, [ctx.a.id, ctx.c.id]);
    const sharedWithoutA = await makeAgentToken(ctx, ctx.b.id, [ctx.c.id]);
    const sharedRepeated = await makeAgentToken(ctx, ctx.b.id, [ctx.a.id, ctx.c.id, ctx.a.id, ctx.a.id]);

    await deleteA(ctx);

    const after = await prisma.agentToken.findUnique({ where: { id: sharedWithA.id } });
    expect(after).not.toBeNull();
    expect(after!.sharedWith).toEqual([ctx.c.id]);
    expect((await prisma.agentToken.findUnique({ where: { id: sharedWithoutA.id } }))!.sharedWith).toEqual([
      ctx.c.id,
    ]);
    // An id present more than once is removed everywhere, not just once.
    expect((await prisma.agentToken.findUnique({ where: { id: sharedRepeated.id } }))!.sharedWith).toEqual([
      ctx.c.id,
    ]);
  });

  it("deletes inbox items this user triggered in other users' inboxes, and keeps other actors' and system items", async () => {
    const item = (actorId: string | null, title: string) =>
      prisma.inboxItem.create({
        data: {
          recipientId: ctx.b.id,
          actorId,
          type: 'mention',
          title,
          message: `excerpt of ${title}`,
        },
      });
    const fromA = await item(ctx.a.id, 'from a');
    const fromC = await item(ctx.c.id, 'from c');
    const system = await item(null, 'system');

    await deleteA(ctx);

    expect(await prisma.inboxItem.findUnique({ where: { id: fromA.id } })).toBeNull();
    expect(await prisma.inboxItem.findUnique({ where: { id: fromC.id } })).toEqual(fromC);
    expect(await prisma.inboxItem.findUnique({ where: { id: system.id } })).toEqual(system);
  });

  it('keeps a used invite code, deactivated, when its redeemer self-deletes first and its creator self-deletes later', async () => {
    // Two real registrations: creator X and redeemer Y, plus the ctx users
    // as bystanders. Y redeems X's single-use code, Y deletes, then X deletes.
    const register = async (label: string) => {
      const username = uniq(label);
      const reg = await request(app).post('/api/auth/register').send({
        username,
        email: `${username}@test.example.com`,
        password: PASSWORD,
        displayName: `PII ${label}`,
        userType: 'HUMAN',
      });
      expect(reg.status).toBe(201);
      return { id: reg.body.user.id as string, token: reg.body.token as string };
    };
    const remove = async (u: { id: string; token: string }) => {
      const res = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ password: PASSWORD });
      expect(res.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    };
    const creator = await register('x');
    const redeemer = await register('y');
    const code = await makeInvite(ctx, {
      createdById: creator.id,
      usedById: redeemer.id,
      note: `for ${redeemer.id}`,
    });
    try {
      await remove(redeemer);
      const mid = await prisma.inviteCode.findUnique({ where: { id: code.id } });
      expect(mid!.usedById).toBeNull();
      expect(mid!.note).toBeNull();
      expect(mid!.useCount).toBe(1);

      await remove(creator);
      const after = await prisma.inviteCode.findUnique({ where: { id: code.id } });
      expect(after).not.toBeNull();
      expect(after!.createdById).toBeNull();
      expect(after!.usedById).toBeNull();
      expect(after!.useCount).toBe(1);
      expect(after!.isActive).toBe(false);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [creator.id, redeemer.id] } } });
    }
  });

  it("removes the user's mention-limits entry after the transaction committed, and only for that user id", async () => {
    let userStillPresentAtCall: boolean | undefined;
    limiterSpy.mockImplementation(async () => {
      userStillPresentAtCall = (await prisma.user.findUnique({ where: { id: ctx.a.id } })) !== null;
      return true;
    });

    await deleteA(ctx);

    expect(limiterSpy).toHaveBeenCalledTimes(1);
    expect(limiterSpy).toHaveBeenCalledWith(ctx.a.id);
    expect(userStillPresentAtCall).toBe(false);
  });

  it('still answers 200 and logs a warning when the mention-limits cleanup fails', async () => {
    limiterSpy.mockRejectedValue(new Error('EACCES: mention-limits.json'));
    const warnSpy = jest.spyOn(logger, 'warn');
    try {
      await deleteA(ctx);
      expect(limiterSpy).toHaveBeenCalledWith(ctx.a.id);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES: mention-limits.json'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(ctx.a.id));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not touch the mention-limits file when the transaction fails', async () => {
    const transactionSpy = jest
      .spyOn(appPrisma, '$transaction')
      .mockRejectedValueOnce(new Error('unexpected database outage'));
    try {
      const res = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${ctx.a.token}`)
        .send({ password: PASSWORD });
      expect(res.status).toBe(500);
    } finally {
      transactionSpy.mockRestore();
    }
    expect(limiterSpy).not.toHaveBeenCalled();
    expect(await prisma.user.findUnique({ where: { id: ctx.a.id } })).not.toBeNull();
  });
});
