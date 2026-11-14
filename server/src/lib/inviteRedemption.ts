import crypto from 'crypto';
import { InviteCode, Prisma } from '@prisma/client';

/**
 * A new invite code: 12 hex characters (48 bits) from the OS CSPRNG, upper
 * case. Alphanumeric and at most 20 characters, as the register schema
 * demands; the old 7-character base36 code from Math.random carried 36 bits
 * and was predictable.
 */
export function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

/**
 * Thrown inside the registration transaction when the conditional write on the
 * invite code matched no row: another registration took the last use (or the
 * code was deactivated or expired) between the pre-check and this write.
 * Throwing rolls the transaction back, so no user and no membership remain.
 */
export class InviteExhaustedError extends Error {
  constructor() {
    super('Invite code exhausted');
    this.name = 'InviteExhaustedError';
  }
}

/**
 * Consume one use of `invite` for `userId`, atomically.
 *
 * The guard (active, not expired, `useCount` below `maxUses`) and the
 * increment are one conditional UPDATE, so of N parallel redemptions of a code
 * with k uses left exactly k see `count === 1`; the rest wait on the row lock
 * and then re-evaluate the guard against the committed row. `maxUses` is never
 * changed by a redemption, so the value read by the pre-check is a safe
 * constant for the column comparison Prisma cannot express in `where`.
 *
 * The deactivation of a code that reached `maxUses` is a second conditional
 * UPDATE keyed on the stored `useCount` after our increment, in the same
 * transaction, instead of a read followed by a write.
 *
 * Must run on the transaction client of the same transaction that creates the
 * user.
 */
export async function consumeInviteCode(
  tx: Prisma.TransactionClient,
  invite: Pick<InviteCode, 'code' | 'maxUses'>,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const consumed = await tx.inviteCode.updateMany({
    where: {
      code: invite.code,
      isActive: true,
      useCount: { lt: invite.maxUses },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: {
      useCount: { increment: 1 },
      usedById: userId,
      usedAt: now,
    },
  });
  if (consumed.count !== 1) {
    throw new InviteExhaustedError();
  }
  await tx.inviteCode.updateMany({
    where: { code: invite.code, isActive: true, useCount: { gte: invite.maxUses } },
    data: { isActive: false },
  });
}

/**
 * Project-scoped invite (note format `project:<projectId>|email:<invitee>`):
 * add the new user to the project team and its room. Runs on the registration
 * transaction so a lost invite race leaves no membership behind.
 */
export async function addProjectMembership(
  tx: Prisma.TransactionClient,
  note: string | null,
  userId: string,
): Promise<void> {
  if (!note || !note.startsWith('project:')) return;
  const projectId = note.split('|')[0].replace('project:', '').trim();
  if (!projectId) return;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) return;

  const teamIds = Array.from(new Set<string>([
    project.ownerId,
    ...(project.teamMemberIds || []),
    userId,
  ]));
  await tx.project.update({
    where: { id: projectId },
    data: { teamMemberIds: teamIds },
  });

  if (project.roomId) {
    await tx.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId: project.roomId } },
      create: { userId, roomId: project.roomId, role: 'MEMBER' },
      update: {},
    });
  }
}
