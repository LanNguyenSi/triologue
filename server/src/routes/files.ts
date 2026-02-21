/**
 * Auth-gated file serving
 * Ice 🧊 — 2026-02-21
 *
 * Files are only accessible to users/agents who are members of the room
 * where the file was posted. Supports both JWT auth and BYOA agent tokens.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

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
    const agent = await (prisma as any).agentToken.findUnique({
      where: { token },
      select: { userId: true, status: true, isActive: true },
    });
    if (agent && agent.status === 'active' && agent.isActive) {
      return agent.userId;
    }
    return null;
  }

  // Static AI tokens (ICE_TOKEN, LAVA_TOKEN)
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice('Bearer '.length);

    // Check against known AI tokens
    const aiTokenMap: Record<string, string> = {};
    if (process.env.ICE_TOKEN) aiTokenMap[process.env.ICE_TOKEN] = 'ice';
    if (process.env.LAVA_TOKEN) aiTokenMap[process.env.LAVA_TOKEN] = 'lava';

    const aiUsername = aiTokenMap[rawToken];
    if (aiUsername) {
      const user = await prisma.user.findFirst({ where: { username: aiUsername }, select: { id: true } });
      return user?.id ?? null;
    }

    // JWT — inline verify (avoid importing authenticate middleware which sends 401)
    const jwt = await import('jsonwebtoken');
    try {
      const decoded = jwt.default.verify(rawToken, process.env.JWT_SECRET || 'fallback-secret') as any;
      return decoded.userId ?? decoded.id ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * GET /api/files/:filename
 * Serve a file only if the requester is a member of the room where it was posted.
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
    // Find which room this file belongs to (via message_attachments → messages)
    const attachment = await prisma.messageAttachment.findFirst({
      where: { url: `/uploads/${filename}` },
      select: { message: { select: { roomId: true } } },
    });

    if (!attachment) {
      // Orphan file — no associated message. Deny access.
      return res.status(404).json({ error: 'File not found' });
    }

    const roomId = attachment.message.roomId;

    // Check room membership
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of the room containing this file' });
    }

    // Serve the file
    res.sendFile(filePath);
  } catch (err) {
    console.error('[files] access error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export { router as fileRoutes };
