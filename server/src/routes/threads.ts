import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import {
  getLinkedProjectStatus,
  isRoomWriteBlocked,
} from '../utils/projectRoomPolicy';

/**
 * Thread routes, mounted at /api/rooms/:roomId/threads.
 *
 * Authentication is the shared `authenticate` middleware, which accepts a
 * user JWT and a BYOA agent token (`byoa_...`) alike, so an agent that is a
 * member of a room can use every route here.
 *
 * Authorization is room membership, checked first on every route. A caller
 * that is not a participant gets the same 403 whether the room exists or
 * not, and never reaches a thread lookup, so thread ids cannot be probed.
 */
const router = Router({ mergeParams: true });

const MAX_TITLE_LENGTH = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const ACCESS_DENIED = 'Access denied to this room';
const PROJECT_CLOSED =
  'Threads are disabled because the linked project is closed.';

class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function findParticipation(userId: string, roomId: string) {
  return prisma.roomParticipant.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
}

async function isWriteBlocked(roomId: string): Promise<boolean> {
  return isRoomWriteBlocked(await getLinkedProjectStatus(prisma, roomId));
}

function sendError(res: Response, err: unknown, what: string) {
  if (err instanceof RequestError) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error(`Error ${what}:`, err);
  return res.status(500).json({ error: `Failed to ${what}` });
}

// Create a thread. A rootMessageId, when given, must be a top-level message
// of this room; it becomes the first message of the new thread.
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const { title, rootMessageId } = req.body ?? {};

    if (!(await findParticipation(userId, roomId))) {
      return res.status(403).json({ error: ACCESS_DENIED });
    }
    if (await isWriteBlocked(roomId)) {
      return res.status(403).json({ error: PROJECT_CLOSED });
    }

    if (
      typeof title !== 'string' ||
      title.trim() === '' ||
      title.trim().length > MAX_TITLE_LENGTH
    ) {
      return res.status(400).json({
        error: `title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters`,
      });
    }
    if (
      rootMessageId !== undefined &&
      rootMessageId !== null &&
      (typeof rootMessageId !== 'string' || rootMessageId.trim() === '')
    ) {
      return res
        .status(400)
        .json({ error: 'rootMessageId must be a non-empty string when present' });
    }
    const rootId: string | null =
      typeof rootMessageId === 'string' ? rootMessageId.trim() : null;

    if (rootId !== null) {
      const root = await prisma.message.findUnique({
        where: { id: rootId },
        select: { id: true, roomId: true, threadId: true },
      });
      if (!root || root.roomId !== roomId) {
        return res
          .status(400)
          .json({ error: 'rootMessageId must name a message in this room' });
      }
      if (root.threadId) {
        return res
          .status(400)
          .json({ error: 'rootMessageId is already part of a thread' });
      }
    }

    const thread = await prisma.$transaction(async (tx) => {
      const created = await tx.thread.create({
        data: {
          title: title.trim(),
          roomId,
          createdBy: userId,
          messageCount: rootId !== null ? 1 : 0,
        },
      });
      if (rootId !== null) {
        // The threadId: null condition makes a root that was claimed by
        // another thread since the check above fail instead of moving it.
        const linked = await tx.message.updateMany({
          where: { id: rootId, roomId, threadId: null },
          data: { threadId: created.id },
        });
        if (linked.count !== 1) {
          throw new RequestError(400, 'rootMessageId is no longer available');
        }
      }
      return created;
    });

    const io = req.app.get('io');
    if (io) {
      io.to(roomId).emit('thread:created', thread);
    }

    return res.status(201).json(thread);
  } catch (err) {
    return sendError(res, err, 'create thread');
  }
});

// List the room's threads, newest activity first. `limit` (default 50, at
// most 100) and `before` page the list: `before` is the id of the last
// thread of the previous page.
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const before = req.query.before;

    if (!(await findParticipation(userId, roomId))) {
      return res.status(403).json({ error: ACCESS_DENIED });
    }

    if (before !== undefined && (typeof before !== 'string' || before === '')) {
      return res.status(400).json({ error: 'before must be a thread id' });
    }

    let cursorFilter = {};
    if (typeof before === 'string') {
      const cursor = await prisma.thread.findFirst({
        where: { id: before, roomId },
        select: { id: true, lastActivity: true },
      });
      if (!cursor) {
        return res
          .status(400)
          .json({ error: 'before must name a thread in this room' });
      }
      cursorFilter = {
        OR: [
          { lastActivity: { lt: cursor.lastActivity } },
          { lastActivity: cursor.lastActivity, id: { lt: cursor.id } },
        ],
      };
    }

    const threads = await prisma.thread.findMany({
      where: { roomId, ...cursorFilter },
      orderBy: [{ lastActivity: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return res.json(threads);
  } catch (err) {
    return sendError(res, err, 'list threads');
  }
});

// Resolve or reopen a thread. Allowed for the thread's creator, a room
// admin or owner, and a system admin.
router.patch('/:threadId', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { roomId, threadId } = req.params;
    const { isResolved } = req.body ?? {};

    const participation = await findParticipation(userId, roomId);
    if (!participation) {
      return res.status(403).json({ error: ACCESS_DENIED });
    }
    if (typeof isResolved !== 'boolean') {
      return res.status(400).json({ error: 'isResolved must be a boolean' });
    }

    const thread = await prisma.thread.findFirst({
      where: { id: threadId, roomId },
      select: { id: true, createdBy: true },
    });
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const mayResolve =
      thread.createdBy === userId ||
      participation.role === 'OWNER' ||
      participation.role === 'ADMIN' ||
      req.user!.isAdmin === true;
    if (!mayResolve) {
      return res
        .status(403)
        .json({ error: 'Only the creator, a room admin or a system admin can resolve a thread' });
    }
    if (await isWriteBlocked(roomId)) {
      return res.status(403).json({ error: PROJECT_CLOSED });
    }

    const updated = await prisma.thread.update({
      where: { id: thread.id },
      data: { isResolved },
    });
    return res.json(updated);
  } catch (err) {
    return sendError(res, err, 'update thread');
  }
});

export { router as threadRoutes };
