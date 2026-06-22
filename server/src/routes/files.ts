/**
 * Auth-gated file serving
 * Ice 🧊 — 2026-02-21
 *
 * Files are only accessible to users/agents who are authorized in the
 * originating scope:
 *   - message attachments: room membership
 *   - task/project attachments: project membership or linked-room membership
 * Supports both JWT auth and BYOA agent tokens.
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';

const router = Router();

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

async function hasProjectScopedAccess(
  userId: string,
  project: { ownerId: string; teamMemberIds: string[]; roomId?: string | null },
): Promise<boolean> {
  const isProjectMember = project.ownerId === userId || project.teamMemberIds.includes(userId);
  if (isProjectMember) return true;

  if (!project.roomId) return false;
  const roomMembership = await prisma.roomParticipant.findUnique({
    where: { userId_roomId: { userId, roomId: project.roomId } },
    select: { userId: true },
  });
  return Boolean(roomMembership);
}

/**
 * Resolve the requesting user's ID from either:
 *   1. JWT token (Authorization: Bearer <jwt>) → req.user via authenticate middleware
 *   2. BYOA agent token (Authorization: Bearer byoa_...)
 * Returns userId or null if unauthenticated.
 */
async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization ?? '';

  // BYOA agent token
  if (authHeader.startsWith('Bearer byoa_')) {
    const token = authHeader.slice('Bearer '.length);
    const agent = await prisma.agentToken.findUnique({
      where: { token },
      select: { userId: true, status: true, isActive: true },
    });
    if (agent && agent.status === 'active' && agent.isActive) {
      return agent.userId;
    }
    return null;
  }

  // JWT or BYOA agent token
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice('Bearer '.length);

    // BYOA agent token (all agents including Ice, Lava)
    if (rawToken.startsWith('byoa_')) {
      const agent = await prisma.agentToken.findUnique({
        where: { token: rawToken },
        select: { userId: true, status: true, isActive: true },
      });
      if (agent && agent.status === 'active' && agent.isActive) {
        return agent.userId;
      }
      return null;
    }

    // JWT — inline verify (avoid importing authenticate middleware which sends 401)
    const jwt = await import('jsonwebtoken');
    try {
      if (!process.env.JWT_SECRET) return null;
      const decoded = jwt.default.verify(rawToken, process.env.JWT_SECRET) as { userId?: string; id?: string };
      return decoded.userId ?? decoded.id ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * GET /api/files/:filename
 * Serve a file only if the requester is authorized for the scope where it was posted.
 *
 * Auth methods:
 *   - Authorization: Bearer <jwt>        (browser/API)
 *   - Authorization: Bearer byoa_<token>  (BYOA agents)
 *   - ?token=<jwt>                        (browser <img src> fallback)
 */
router.get('/:filename', async (req: Request, res: Response) => {
  const { filename } = req.params;

  // Sanitize filename — no path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Support ?token= query param for <img src> in browser
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }

  // Resolve who's asking
  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to access files' });
  }

  try {
    const fileUrl = `/uploads/${filename}`;

    // 1) Message attachment → room-based access
    const attachment = await prisma.messageAttachment.findFirst({
      where: { url: fileUrl },
      select: { message: { select: { roomId: true } } },
    });

    if (attachment) {
      const roomId = attachment.message.roomId;

      const membership = await prisma.roomParticipant.findUnique({
        where: { userId_roomId: { userId, roomId } },
      });

      if (!membership) {
        return res.status(403).json({ error: 'You are not a member of the room containing this file' });
      }

      return res.sendFile(filePath);
    }

    // 2) Task attachment → project-based access
    const taskAttachment = await prisma.taskAttachment.findFirst({
      where: { url: fileUrl },
      select: {
        task: {
          select: {
            project: {
              select: {
                ownerId: true,
                teamMemberIds: true,
                roomId: true,
              },
            },
          },
        },
      },
    });

    if (!taskAttachment) {
      const projectAttachment = await prisma.projectAttachment.findFirst({
        where: { url: fileUrl },
        select: {
          project: {
            select: {
              ownerId: true,
              teamMemberIds: true,
              roomId: true,
            },
          },
        },
      });

      if (!projectAttachment) {
        // Orphan file — no associated message/task/project. Deny access.
        return res.status(404).json({ error: 'File not found' });
      }

      const project = projectAttachment.project;
      const hasAccess = await hasProjectScopedAccess(userId, project);
      if (!hasAccess) {
        return res.status(403).json({ error: 'You are not allowed to access this project file' });
      }

      return res.sendFile(filePath);
    }

    const project = taskAttachment.task.project;
    const hasAccess = await hasProjectScopedAccess(userId, project);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You are not allowed to access this project file' });
    }

    return res.sendFile(filePath);
  } catch (err) {
    console.error('[files] access error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export { router as fileRoutes };
