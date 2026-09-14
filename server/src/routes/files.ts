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
import { ALLOWED_UPLOAD_MIME_TYPES } from '../utils/uploadMimeTypes';

const router = Router();

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

// MIME types safe to render inline in the browser. This is derived from the
// shared upload allowlist, so a legacy stored `image/svg+xml` row cannot gain
// inline treatment merely because it has an `image/` prefix. Everything not
// in this set is served as a forced download with
// X-Content-Type-Options: nosniff, so a browser never sniffs stored content
// (e.g. an allowlisted text/plain upload with an on-disk .html extension)
// into an HTML/script-executing context on this origin.
const INLINE_SAFE_MIME_TYPES = new Set(
  [...ALLOWED_UPLOAD_MIME_TYPES].filter((mimeType) => mimeType.startsWith('image/')),
);

function isInlineSafeMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && INLINE_SAFE_MIME_TYPES.has(mimeType);
}

// Content-Disposition filename must not contain characters that could break
// out of the quoted value or inject a CR/LF into the header. Backslash is
// stripped too: an unescaped trailing backslash would otherwise produce a
// malformed quoted-string (e.g. `filename="foo\"` unbalances the closing
// quote). The ASCII-sanitised name is paired with an RFC 6266/5987
// `filename*=UTF-8''...` parameter carrying the real (percent-encoded,
// non-ASCII-preserving) filename, since browsers prefer `filename*` when
// present and otherwise fall back to the ASCII `filename`.
function sanitizeForContentDisposition(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, "'");
}

// `encodeURIComponent` leaves `'`, `(`, `)` and `*` unescaped, which are not
// RFC 5987 attr-chars for the `filename*=UTF-8''...` extended-value
// parameter. Express's `content-disposition` parser is stricter than
// `encodeURIComponent` and rejects a header carrying those raw characters
// (e.g. a stored display filename like `o'brien (final).txt`) with "invalid
// extended field value". Percent-encode them explicitly on top of
// `encodeURIComponent`'s output.
function encodeExtValueForContentDisposition(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Serve a stored upload with Content-Type derived from its validated,
 * DB-stored mimetype — never from the on-disk file extension, which is
 * derived from the user-controlled original filename (see files.ts task
 * 2fec600d). Non-inline-safe types are forced to download with nosniff so a
 * browser cannot be tricked into rendering them as HTML/script.
 */
function serveStoredFile(
  res: Response,
  filePath: string,
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): void {
  const contentType = mimeType || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': contentType };

  if (!isInlineSafeMimeType(mimeType)) {
    const rawName = filename || 'download';
    const safeName = sanitizeForContentDisposition(rawName);
    const encodedName = encodeExtValueForContentDisposition(rawName);
    headers['Content-Disposition'] =
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
    headers['X-Content-Type-Options'] = 'nosniff';
  }

  res.sendFile(filePath, { headers });
}

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
      select: { mimeType: true, filename: true, message: { select: { roomId: true } } },
    });

    if (attachment) {
      const roomId = attachment.message.roomId;

      const membership = await prisma.roomParticipant.findUnique({
        where: { userId_roomId: { userId, roomId } },
      });

      if (!membership) {
        return res.status(403).json({ error: 'You are not a member of the room containing this file' });
      }

      return serveStoredFile(res, filePath, attachment.mimeType, attachment.filename);
    }

    // 2) Task attachment → project-based access
    const taskAttachment = await prisma.taskAttachment.findFirst({
      where: { url: fileUrl },
      select: {
        mimeType: true,
        filename: true,
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
          mimeType: true,
          filename: true,
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

      return serveStoredFile(res, filePath, projectAttachment.mimeType, projectAttachment.filename);
    }

    const project = taskAttachment.task.project;
    const hasAccess = await hasProjectScopedAccess(userId, project);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You are not allowed to access this project file' });
    }

    return serveStoredFile(res, filePath, taskAttachment.mimeType, taskAttachment.filename);
  } catch (err) {
    console.error('[files] access error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export { router as fileRoutes };
