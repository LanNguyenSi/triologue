import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

interface IoLike {
  to(room: string): { emit(event: string, data: unknown): void };
}

export interface InboxCreateInput {
  recipientIds: string[];
  actorId?: string | null;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  roomId?: string | null;
  taskId?: string | null;
  messageId?: string | null;
  excludeActor?: boolean;
  io?: unknown;
}

function trimText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function uniqueRecipients(recipientIds: string[], actorId?: string | null, excludeActor = true): string[] {
  const deduped = new Set<string>();

  for (const id of recipientIds) {
    if (typeof id !== 'string') continue;
    const normalized = id.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }

  if (excludeActor && actorId) {
    deduped.delete(actorId);
  }

  return Array.from(deduped);
}

export function extractMentionHandles(content: string): string[] {
  if (!content?.trim()) return [];

  const handles = new Set<string>();
  const regex = /(^|\s)@([a-zA-Z0-9._-]{1,64})/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(content)) !== null) {
    const handle = match[2]?.toLowerCase();
    if (handle) handles.add(handle);
  }

  return Array.from(handles);
}

export async function createInboxItems(input: InboxCreateInput) {
  const recipients = uniqueRecipients(input.recipientIds, input.actorId, input.excludeActor === true);
  if (recipients.length === 0) return [];

  const title = trimText(input.title, 180) || 'Update';
  const message = trimText(input.message || '', 1200) || null;
  const link = trimText(input.link || '', 500) || null;

  const operations = recipients.map((recipientId) =>
    prisma.inboxItem.create({
      data: {
        recipientId,
        actorId: input.actorId || null,
        type: trimText(input.type, 80) || 'system.update',
        title,
        message,
        link,
        metadata: (input.metadata || undefined) as Prisma.InputJsonValue | undefined,
        projectId: input.projectId || null,
        roomId: input.roomId || null,
        taskId: input.taskId || null,
        messageId: input.messageId || null,
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true,
          },
        },
      },
    }),
  );

  const created = await prisma.$transaction(operations);

  if (input.io) {
    const io = input.io as IoLike;
    for (const item of created) {
      io.to(`user:${item.recipientId}`).emit('inbox:new', item);
    }
  }

  return created;
}

function summarizeMessage(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 220);
}

interface MentionInboxInput {
  roomId: string;
  actorId: string;
  content: string;
  messageId: string;
  io?: IoLike;
}

export async function createMentionInboxItems(input: MentionInboxInput) {
  const handles = extractMentionHandles(input.content || '');
  if (handles.length === 0) return [];

  const [participants, activeAgents] = await Promise.all([
    prisma.roomParticipant.findMany({
      where: { roomId: input.roomId },
      select: {
        userId: true,
        user: { select: { username: true } },
      },
    }),
    prisma.agentToken.findMany({
      where: {
        isActive: true,
        status: 'active',
        agentUser: {
          participations: { some: { roomId: input.roomId } },
        },
      },
      select: {
        userId: true,
        mentionKey: true,
      },
    }),
  ]);

  const handleToUserId = new Map<string, string>();

  for (const participant of participants) {
    const username = participant.user?.username?.toLowerCase();
    if (username) handleToUserId.set(username, participant.userId);
  }

  for (const agent of activeAgents) {
    const mentionKey = String(agent.mentionKey || '').toLowerCase();
    if (mentionKey) handleToUserId.set(mentionKey, agent.userId);
  }

  const recipientIds: string[] = [];
  for (const handle of handles) {
    const recipientId = handleToUserId.get(handle);
    if (recipientId) recipientIds.push(recipientId);
  }

  if (recipientIds.length === 0) return [];

  return createInboxItems({
    recipientIds,
    actorId: input.actorId,
    excludeActor: true,
    type: 'chat.mentioned',
    title: 'Mention in chat',
    message: summarizeMessage(input.content || ''),
    link: `/room/${input.roomId}`,
    roomId: input.roomId,
    messageId: input.messageId,
    io: input.io,
  });
}
