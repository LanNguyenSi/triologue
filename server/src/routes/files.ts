/**
 * Auth-gated file serving
 * Ice 🧊 — 2026-02-21
 *
 * Files are only accessible to users/agents who are authorized in the
 * originating scope:
 *   - message attachments: room membership
 *   - task/project attachments: project membership or linked-room membership
 * Supports JWT auth and BYOA agent tokens in the Authorization header, and a
 * short-lived file-scoped token in `?ft=` for `<img src>` / `<a href>` URLs
 * (the session JWT is never accepted in the query).
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';
import { UPLOAD_DIR } from '../lib/uploadDir';
import { findAgentTokenByRawToken } from '../services/agentTokenRotation';
import { ALLOWED_UPLOAD_MIME_TYPES } from '../utils/uploadMimeTypes';
import { authenticate } from '../middleware/auth';
import { mintFileToken, verifyFileToken } from '../lib/scopedToken';

const router = Router();

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

/**
 * Resolve the requesting user's ID from either:
 *   1. JWT token (Authorization: Bearer <jwt>)
 *   2. BYOA agent token (Authorization: Bearer byoa_...)
 *   3. A file-scoped token in `?ft=` (no Authorization header), bound to this
 *      file name and one user, checked again for an active user here
 * The session JWT in the query (`?token=`) is not read at all.
 * Returns userId or null if unauthenticated.
 */
async function resolveUserId(req: Request, filename: string): Promise<string | null> {
  const authHeader = req.headers.authorization ?? '';

  // BYOA agent token
  if (authHeader.startsWith('Bearer byoa_')) {
    const token = authHeader.slice('Bearer '.length);
    const agent = await findAgentTokenByRawToken(token, {
      select: { userId: true, status: true, isActive: true },
    });
    if (agent && agent.status === 'active' && agent.isActive) {
      return agent.userId;
    }
    return null;
  }

  // JWT (a `byoa_` token never reaches here: it returned above)
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice('Bearer '.length);

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

  // File-scoped token (browser <img src> / <a href>). Only when no header is sent.
  if (!authHeader) {
    const verified = verifyFileToken(filename, req.query.ft);
    if (!verified) return null;
    const user = await prisma.user.findUnique({
      where: { id: verified.userId },
      select: { isActive: true },
    });
    return user?.isActive ? verified.userId : null;
  }

  return null;
}

type FileAccess =
  | { ok: true; mimeType: string | null | undefined; filename: string | null | undefined }
  | { ok: false; status: 403 | 404; error: string };

type ProjectScope = { ownerId: string; teamMemberIds: string[]; roomId?: string | null };

const PROJECT_SCOPE_SELECT = { ownerId: true, teamMemberIds: true, roomId: true } as const;

/**
 * The file ACL for several stored names at once, evaluated against the
 * database on every call (serving and token issue): message attachments need
 * room membership, task and project attachments need project membership or
 * membership of the linked room. A stored file without an attachment row is
 * denied. The first table that has a row for a name decides (message, then
 * task, then project), even when a later table would allow.
 *
 * The number of queries does not depend on the number of names: one
 * findMany per attachment table (a later table only for names that no earlier
 * table had a row for) and one room-membership lookup for every room that
 * needs a check, so at most four Prisma calls in total (Prisma may issue a few
 * more SQL statements for the nested selects, still independent of the
 * number of names). When a table holds several rows
 * for one url (the column is not unique), the row with the lowest id decides,
 * including the mime type and filename served.
 */
async function authorizeFileAccessBatch(
  userId: string,
  filenames: string[],
): Promise<Map<string, FileAccess>> {
  type Decision =
    | { kind: 'message'; roomId: string; mimeType: string | null | undefined; filename: string | null | undefined }
    | { kind: 'project'; project: ProjectScope; mimeType: string | null | undefined; filename: string | null | undefined };

  const names = [...new Set(filenames)];
  const decisions = new Map<string, Decision>();
  const unresolved = () => names.filter((n) => !decisions.has(n));
  const urlOf = (name: string) => `/uploads/${name}`;
  const nameOfUrl = new Map(names.map((n) => [urlOf(n), n]));

  // Fail closed on a missing identity: Prisma reads `userId: undefined` in a
  // where clause as "no filter", so the membership lookup below would match
  // other users' rows. Every caller passes a real id today; this keeps the
  // resolver safe on its own.
  if (typeof userId !== 'string' || userId === '') {
    return new Map(names.map((n) => [n, { ok: false, status: 403, error: 'Not authorized' } as FileAccess]));
  }

  if (names.length > 0) {
    // 1) Message attachments → room-based access
    const messageRows = await prisma.messageAttachment.findMany({
      where: { url: { in: names.map(urlOf) } },
      orderBy: { id: 'asc' },
      select: { url: true, mimeType: true, filename: true, message: { select: { roomId: true } } },
    });
    for (const row of messageRows) {
      const name = nameOfUrl.get(row.url);
      if (name === undefined || decisions.has(name)) continue;
      decisions.set(name, {
        kind: 'message',
        roomId: row.message.roomId,
        mimeType: row.mimeType,
        filename: row.filename,
      });
    }

    // 2) Task attachments → project-based access
    let rest = unresolved();
    if (rest.length > 0) {
      const taskRows = await prisma.taskAttachment.findMany({
        where: { url: { in: rest.map(urlOf) } },
        orderBy: { id: 'asc' },
        select: {
          url: true,
          mimeType: true,
          filename: true,
          task: { select: { project: { select: PROJECT_SCOPE_SELECT } } },
        },
      });
      for (const row of taskRows) {
        const name = nameOfUrl.get(row.url);
        if (name === undefined || decisions.has(name)) continue;
        decisions.set(name, {
          kind: 'project',
          project: row.task.project,
          mimeType: row.mimeType,
          filename: row.filename,
        });
      }
    }

    // 3) Project attachments → project-based access
    rest = unresolved();
    if (rest.length > 0) {
      const projectRows = await prisma.projectAttachment.findMany({
        where: { url: { in: rest.map(urlOf) } },
        orderBy: { id: 'asc' },
        select: {
          url: true,
          mimeType: true,
          filename: true,
          project: { select: PROJECT_SCOPE_SELECT },
        },
      });
      for (const row of projectRows) {
        const name = nameOfUrl.get(row.url);
        if (name === undefined || decisions.has(name)) continue;
        decisions.set(name, {
          kind: 'project',
          project: row.project,
          mimeType: row.mimeType,
          filename: row.filename,
        });
      }
    }
  }

  // One membership lookup for every room that still needs a check. Project
  // owners and team members need none.
  const roomIdFor = (d: Decision): string | null => {
    if (d.kind === 'message') return d.roomId;
    const { ownerId, teamMemberIds, roomId } = d.project;
    if (ownerId === userId || teamMemberIds.includes(userId)) return null;
    return roomId ?? null;
  };
  const roomIds = [...new Set([...decisions.values()].map(roomIdFor).filter((r): r is string => r !== null))];
  const memberOf = new Set<string>();
  if (roomIds.length > 0) {
    const memberships = await prisma.roomParticipant.findMany({
      where: { userId, roomId: { in: roomIds } },
      select: { roomId: true },
    });
    for (const m of memberships) memberOf.add(m.roomId);
  }

  const result = new Map<string, FileAccess>();
  for (const name of names) {
    const d = decisions.get(name);
    if (!d) {
      // Orphan file: no associated message/task/project. Deny access.
      result.set(name, { ok: false, status: 404, error: 'File not found' });
    } else if (d.kind === 'message') {
      result.set(
        name,
        memberOf.has(d.roomId)
          ? { ok: true, mimeType: d.mimeType, filename: d.filename }
          : { ok: false, status: 403, error: 'You are not a member of the room containing this file' },
      );
    } else {
      const roomId = roomIdFor(d);
      const allowed = d.project.ownerId === userId || d.project.teamMemberIds.includes(userId) ||
        (roomId !== null && memberOf.has(roomId));
      result.set(
        name,
        allowed
          ? { ok: true, mimeType: d.mimeType, filename: d.filename }
          : { ok: false, status: 403, error: 'You are not allowed to access this project file' },
      );
    }
  }
  return result;
}

async function authorizeFileAccess(userId: string, filename: string): Promise<FileAccess> {
  const results = await authorizeFileAccessBatch(userId, [filename]);
  return results.get(filename) ?? { ok: false, status: 404, error: 'File not found' };
}

function isSafeFilename(filename: string): boolean {
  return filename.length > 0 && !filename.includes('..') && !filename.includes('/') && !filename.includes('\\');
}

const MAX_TOKENS_PER_REQUEST = 50;

/**
 * POST /api/files/tokens   { filenames: string[] }
 * Issue file-scoped tokens for the files the caller may access right now.
 * Returns { tokens: { [filename]: { token, expiresIn } }, denied: string[] }.
 * Names the caller may not access (or that do not exist) are listed in
 * `denied` and get no token. A token only carries identity; the ACL is run
 * again when the file is served.
 */
router.post('/tokens', authenticate, async (req: Request, res: Response) => {
  const filenames: unknown = req.body?.filenames;
  if (
    !Array.isArray(filenames) ||
    filenames.length === 0 ||
    filenames.length > MAX_TOKENS_PER_REQUEST ||
    !filenames.every((f) => typeof f === 'string')
  ) {
    return res
      .status(400)
      .json({ error: `filenames must be a non-empty array of at most ${MAX_TOKENS_PER_REQUEST} strings` });
  }

  const userId = req.user!.id;
  const unique = [...new Set(filenames as string[])];
  try {
    const safe = unique.filter(isSafeFilename);
    const access = await authorizeFileAccessBatch(userId, safe);
    const results = unique.map((filename) => {
      const decision = access.get(filename);
      return { filename, token: decision?.ok ? mintFileToken(filename, userId) : null };
    });

    const tokens: Record<string, { token: string; expiresIn: number }> = {};
    const denied: string[] = [];
    for (const { filename, token } of results) {
      if (token) tokens[filename] = { token: token.token, expiresIn: token.expiresIn };
      else denied.push(filename);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ tokens, denied });
  } catch (err) {
    console.error('[files] token issue error:', err);
    return res.status(500).json({ error: 'Failed to issue file tokens' });
  }
});

/**
 * GET /api/files/:filename
 * Serve a file only if the requester is authorized for the scope where it was posted.
 *
 * Auth methods:
 *   - Authorization: Bearer <jwt>        (browser/API)
 *   - Authorization: Bearer byoa_<token>  (BYOA agents)
 *   - ?ft=<file token>                    (browser <img src>/<a href>; see POST /tokens)
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

  // Resolve who's asking
  const userId = await resolveUserId(req, filename);
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to access files' });
  }

  try {
    const access = await authorizeFileAccess(userId, filename);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    return serveStoredFile(res, filePath, access.mimeType, access.filename);
  } catch (err) {
    console.error('[files] access error:', err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export { router as fileRoutes };

// Exported for tests only.
export { authorizeFileAccessBatch as authorizeFileAccessBatchForTest };
