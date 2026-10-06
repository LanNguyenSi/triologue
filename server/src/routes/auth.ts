import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserType, InviteCode, Prisma } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { userSchemas, validate, sanitize } from '../utils/validation';
import { authenticate, requireHuman } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { removeMentionLimitEntry } from '../services/mentionLimiter';

const router = Router();

// Registration mode is resolved once at module import.
// Default `invite` is the secure-by-default choice: an operator who
// forgets to set REGISTRATION_MODE gets closed-beta behaviour, not
// open self-signup. To allow open registration, set REGISTRATION_MODE
// to `open` explicitly. Any other value throws at boot so typos like
// `Open` or `INVITE` do not silently fall through to open.
const VALID_REGISTRATION_MODES = ['open', 'invite', 'closed'] as const;
type RegistrationMode = typeof VALID_REGISTRATION_MODES[number];

const REGISTRATION_MODE: RegistrationMode = (() => {
  const raw = process.env.REGISTRATION_MODE;
  if (raw === undefined || raw === '') return 'invite';
  if ((VALID_REGISTRATION_MODES as readonly string[]).includes(raw)) {
    return raw as RegistrationMode;
  }
  throw new Error(
    `REGISTRATION_MODE must be one of ${VALID_REGISTRATION_MODES.join(', ')} (got ${JSON.stringify(raw)})`,
  );
})();

// Rate limiting configurations
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // AI agents with valid tokens don't need rate limiting — they use long-lived JWTs
  skip: (req) => {
    // Disabled under test: the shared in-memory store accumulates across the
    // whole suite and would 429 unrelated cases; a dedicated test covers the
    // limiter itself.
    if (process.env.NODE_ENV === 'test') return true;
    const body = req.body || {};
    return body.userType && body.userType.startsWith('AI_');
  },
});

const registerLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'Too many registration attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Disabled under test: the integration suite registers many users from one
  // IP and the limiter is not the subject of those cases.
  skip: () => process.env.NODE_ENV === 'test',
});

// Registration endpoint
router.post('/register', registerLimit, validate(userSchemas.register), async (req, res) => {
  try {
    const { username, email, password, displayName, userType, inviteCode } = req.body;
    let matchedInvite: InviteCode | null = null;

    // AI_* accounts are provisioned exclusively through the authenticated
    // BYOA agent-token flow (POST /api/agents), never through this public,
    // unauthenticated route. Both mode gates below are conditioned on
    // `userType === 'HUMAN'`, so without this check a self-declared
    // userType: 'AI_AGENT' (etc.) would skip the closed-beta block and the
    // invite-code requirement entirely, letting an anonymous caller mint an
    // active account with a 30-day JWT. Reject any client-supplied
    // non-HUMAN userType outright, independent of REGISTRATION_MODE.
    if (userType && userType !== 'HUMAN') {
      return res.status(403).json({ error: 'Self-registration is only available for human accounts.' });
    }

    if (REGISTRATION_MODE === 'closed' && userType === 'HUMAN') {
      return res.status(403).json({ error: 'Registration is currently closed.' });
    }

    // Sanitize inputs
    const cleanUsername = sanitize.username(username);
    const cleanEmail = sanitize.email(email);
    const cleanDisplayName = sanitize.displayName(displayName);

    // ── Username/email uniqueness FIRST (before invite check) ────────
    // This gives clear feedback even if no invite code has been entered yet
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { email: cleanEmail }
        ]
      }
    });

    if (existingUser) {
      return res.status(409).json({
        error: existingUser.username === cleanUsername
          ? 'Username already taken.'
          : 'Email already registered.'
      });
    }
    // ────────────────────────────────────────────────────────────────

    // ── Invite code check (after uniqueness — so username errors show first) ──
    if (REGISTRATION_MODE === 'invite' && userType === 'HUMAN') {
      if (!inviteCode) {
        return res.status(403).json({ error: 'An invite code is required (closed beta).' });
      }
      const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
      if (!invite || !invite.isActive) {
        return res.status(403).json({ error: 'Invalid or already used invite code.' });
      }
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        return res.status(403).json({ error: 'This invite code has expired.' });
      }
      if (invite.useCount >= invite.maxUses) {
        return res.status(403).json({ error: 'This invite code has already been used.' });
      }
      matchedInvite = invite;
    }
    // ────────────────────────────────────────────────────────────────

    // Hash password for human users
    let passwordHash: string | null = null;
    if (userType === 'HUMAN') {
      const saltRounds = 12;
      passwordHash = await bcrypt.hash(password, saltRounds);
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        displayName: cleanDisplayName,
        userType: userType as UserType,
        passwordHash,
        isActive: true,
        usedInviteCode: inviteCode ?? null,
      }
    });

    // Consume invite code if used
    if (REGISTRATION_MODE === 'invite' && inviteCode && userType === 'HUMAN') {
      await prisma.inviteCode.update({
        where: { code: inviteCode },
        data: {
          useCount: { increment: 1 },
          usedById: user.id,
          usedAt: new Date(),
          // Deactivate if max uses reached
          isActive: undefined, // will be set below via separate check
        }
      });
      // Deactivate if single-use
      const updatedInvite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
      if (updatedInvite && updatedInvite.useCount >= updatedInvite.maxUses) {
        await prisma.inviteCode.update({ where: { code: inviteCode }, data: { isActive: false } });
      }
    }

    // Project-scoped invite code support:
    // note format: project:<projectId>|email:<invitee@email>
    if (matchedInvite?.note && typeof matchedInvite.note === 'string' && matchedInvite.note.startsWith('project:')) {
      const projectId = matchedInvite.note.split('|')[0].replace('project:', '').trim();
      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
          const teamIds = Array.from(new Set<string>([
            project.ownerId,
            ...(project.teamMemberIds || []),
            user.id,
          ]));

          await prisma.project.update({
            where: { id: projectId },
            data: { teamMemberIds: teamIds },
          });

          if (project.roomId) {
            await prisma.roomParticipant.upsert({
              where: { userId_roomId: { userId: user.id, roomId: project.roomId } },
              create: { userId: user.id, roomId: project.roomId, role: 'MEMBER' },
              update: {},
            });
          }
        }
      }
    }

    // Auto-join all public rooms on registration
    try {
      const publicRooms = await prisma.room.findMany({
        where: { isPrivate: false }
      });

      for (const room of publicRooms) {
        await prisma.roomParticipant.create({
          data: {
            userId: user.id,
            roomId: room.id,
            role: 'MEMBER'
          }
        });
      }
    } catch (roomError) {
      console.error('Failed to auto-join public rooms:', roomError);
      // Don't fail registration if room join fails
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        userType: user.userType 
      },
      process.env.JWT_SECRET!,
      { expiresIn: userType === 'HUMAN' ? '7d' : '30d' }
    );

    // Return user without sensitive data (strip both secrets, matching the
    // login/verify/profile/PATCH-me sanitizers; authToken is never echoed back).
    const { passwordHash: _passwordHash, authToken: _authToken, ...safeUser } = user;
    res.status(201).json({
      message: 'User registered successfully',
      user: safeUser,
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Enhanced login endpoint
router.post('/login', loginLimit, validate(userSchemas.login), async (req, res) => {
  try {
    const { username, password, userType, aiToken } = req.body;

    // Sanitize username
    const cleanUsername = sanitize.username(username);

    // Find user
    const user = await prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Authentication logic based on user type
    const isAgent = userType === 'AI_AGENT' || userType === 'AI_ICE' || userType === 'AI_LAVA' || userType === 'AI_OTHER';
    if (isAgent) {
      // AI authentication: validate against AgentToken in database
      if (!aiToken) {
        return res.status(400).json({ error: 'AI token required for AI agents' });
      }

      // Look up agent token in DB (supports both byoa_ prefixed and raw tokens)
      const tokenToCheck = aiToken.startsWith('byoa_') ? aiToken : `byoa_${aiToken}`;
      const agentToken = await prisma.agentToken.findFirst({
        where: {
          userId: user.id,
          OR: [
            { token: aiToken },
            { token: tokenToCheck },
          ],
        },
      });

      if (!agentToken) {
        return res.status(401).json({ error: 'Invalid AI token' });
      }

      if (agentToken.status !== 'active' || !agentToken.isActive) {
        return res.status(401).json({ error: 'Agent token is not active' });
      }
    } else {
      // Human user authentication with password
      if (!password) {
        return res.status(400).json({ error: 'Password required for human users' });
      }

      if (!user.passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify user type
      if (user.userType !== 'HUMAN') {
        return res.status(401).json({ error: 'Invalid user type' });
      }
    }

    // Update last seen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeen: new Date() }
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        userType: user.userType,
        displayName: user.displayName
      },
      process.env.JWT_SECRET!,
      { expiresIn: userType === 'HUMAN' ? '7d' : '30d' }
    );

    // Return user without sensitive data
    const { passwordHash: _passwordHash, authToken: _authToken, ...safeUser } = user;
    res.json({
      message: 'Login successful',
      user: safeUser,
      token
    });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Enhanced token validation
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // Return user without sensitive data
    const { passwordHash: _passwordHash, authToken: _authToken, ...safeUser } = user;
    res.json({
      valid: true,
      user: safeUser
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Password change endpoint (human users only)
router.put('/change-password', authenticate, requireHuman, validate(userSchemas.changePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.passwordHash) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// Logout endpoint (for session tracking)
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      // Update last seen time
      await prisma.user.update({
        where: { id: decoded.userId },
        data: { lastSeen: new Date() }
      });
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch {
    // Even if token is invalid, consider logout successful
    res.json({ message: 'Logged out successfully' });
  }
});

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        _count: {
          select: {
            sentMessages: true,
            reactions: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return user profile without sensitive data
    const { passwordHash: _passwordHash, authToken: _authToken, ...profile } = user;
    res.json(profile);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── Admin: Invite Code Management ───────────────────────────────────────────

// Create invite code (admin only)
router.post('/invite-codes', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { maxUses = 1, expiresAt, note } = req.body;

    // Generate a short, readable code
    const code = Math.random().toString(36).slice(2, 9).toUpperCase();

    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdById: req.user!.id,
        maxUses: Number(maxUses),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        note: note ?? null,
      }
    });

    res.status(201).json({ code: invite.code, invite });
  } catch (error) {
    console.error('Invite code creation error:', error);
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// List invite codes (admin only)
router.get('/invite-codes', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const codes = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(codes);
  } catch {
    res.status(500).json({ error: 'Failed to list invite codes' });
  }
});

// Admin: set canTriggerAI for a user
router.patch('/users/:username/ai-trigger', authenticate, async (req, res) => {
  try {
    const adminUser = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!adminUser?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { canTriggerAI } = req.body;
    if (typeof canTriggerAI !== 'boolean') {
      return res.status(400).json({ error: 'canTriggerAI must be boolean' });
    }
    const updated = await prisma.user.update({
      where: { username: req.params.username },
      data: { canTriggerAI },
    });
    res.json({ username: updated.username, canTriggerAI: updated.canTriggerAI });
  } catch {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Update own profile (displayName, password)
router.patch('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { displayName, currentPassword, newPassword } = req.body;
    const updates: Prisma.UserUpdateInput = {};

    if (displayName) {
      const clean = sanitize.displayName(displayName);
      if (!/^[\p{L}\p{N}\s_\-'.]{2,50}$/u.test(clean)) {
        return res.status(400).json({ error: 'Invalid display name.' });
      }
      updates.displayName = clean;
    }

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required.' });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.passwordHash) return res.status(400).json({ error: 'Cannot change password for this account.' });
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Current password incorrect.' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      updates.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const updated = await prisma.user.update({ where: { id: userId }, data: updates });
    const { passwordHash: _passwordHash, authToken: _authToken, ...safe } = updated;
    res.json({ message: 'Profile updated.', user: safe });
  } catch {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Imports for the upload cleanup below, kept next to their only user.
import fs from 'fs/promises';
import path from 'path';

// Directory the upload routes write to (routes/projects.ts, routes/upload.ts
// and routes/files.ts resolve the same path); attachment rows store
// `/uploads/<filename>`.
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const UPLOAD_URL_PATTERN = /^\/uploads\/[^/]+$/;

// Escape the LIKE metacharacters (backslash, percent, underscore) so a value
// is matched literally by Prisma's `endsWith`, which does not escape them.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Best effort, run strictly after the self-delete transaction committed:
// unlink the upload files that belonged to rows the transaction deleted
// (attachments inside projects the deleted user owned). A URL is acted on
// only when it is exactly `/uploads/<one segment>`, the file name is resolved
// with basename and must sit directly inside UPLOAD_DIR, and the file is left
// alone while any surviving project, task or message attachment row still
// points at the same upload (a copy of the same file, or an attachment the
// deleted user's project shared with a room). The still-referenced lookup is
// batched: one query per table for all collected files, so the time after the
// commit does not grow with a per-file round trip. A failure on one file is
// logged and never fails the request or stops the remaining files; when the
// lookup itself fails every file is kept, since nothing proved it is
// unreferenced.
async function unlinkDeletedUploadFiles(urls: string[], userId: string): Promise<void> {
  // First pass, no I/O: keep only the URLs that pass the shape and
  // containment guards, mapped to the file they would unlink.
  const candidates = new Map<string, { target: string; url: string }>();
  for (const url of new Set(urls)) {
    if (!UPLOAD_URL_PATTERN.test(url)) continue;
    const filename = path.basename(url.slice('/uploads/'.length));
    if (!filename || filename === '.' || filename === '..') continue;
    const target = path.resolve(UPLOAD_DIR, filename);
    if (path.dirname(target) !== UPLOAD_DIR) continue;
    // The suffix is escaped in JS and compared in SQL: `LIKE '%' || suffix`
    // treats backslash, percent and underscore as metacharacters, so the
    // escape is what makes the match literal (a name containing one would
    // otherwise fail to match its own row, and the file would be unlinked
    // while a surviving row still points at it).
    const suffix = escapeLikePattern(`/uploads/${filename}`);
    if (!candidates.has(suffix)) candidates.set(suffix, { target, url });
  }
  if (candidates.size === 0) return;

  // One lookup per table for ALL candidates (a constant number of queries,
  // however many attachments the account had): each returns the subset of
  // suffixes that some surviving row's URL ends with.
  const suffixes = [...candidates.keys()];
  let referenced: Set<string>;
  try {
    const [projectRefs, taskRefs, messageRefs] = await Promise.all([
      prisma.$queryRaw<Array<{ suffix: string }>>`
        SELECT s.suffix FROM unnest(${suffixes}::text[]) AS s(suffix)
        WHERE EXISTS (SELECT 1 FROM project_attachments r WHERE r.url LIKE '%' || s.suffix ESCAPE '\\')`,
      prisma.$queryRaw<Array<{ suffix: string }>>`
        SELECT s.suffix FROM unnest(${suffixes}::text[]) AS s(suffix)
        WHERE EXISTS (SELECT 1 FROM task_attachments r WHERE r.url LIKE '%' || s.suffix ESCAPE '\\')`,
      prisma.$queryRaw<Array<{ suffix: string }>>`
        SELECT s.suffix FROM unnest(${suffixes}::text[]) AS s(suffix)
        WHERE EXISTS (SELECT 1 FROM message_attachments r WHERE r.url LIKE '%' || s.suffix ESCAPE '\\')`,
    ]);
    referenced = new Set([...projectRefs, ...taskRefs, ...messageRefs].map((row) => row.suffix));
  } catch (err) {
    // Nothing proved the files unreferenced: keep all of them.
    logger.warn(
      `Account deleted but upload files were kept, the still-referenced lookup failed: userId=${userId} files=${candidates.size} error=${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  for (const [suffix, { target, url }] of candidates) {
    if (referenced.has(suffix)) continue;
    try {
      await fs.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      logger.warn(
        `Account deleted but an upload file could not be removed: userId=${userId} url=${url} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// Delete own account. What this removes, anonymises and keeps is stated
// here and, with the reasoning per row, in
// docs/okf/self-delete-data-retention.md. Nothing below is a claim of legal
// completeness: rows marked "under review" are current behaviour, not a
// decision. Everything database-side runs in ONE transaction (below), then
// one best-effort file cleanup runs after it commits.
//
// REMOVED by an explicit statement in the transaction: invite codes this user
// created that nobody redeemed (useCount = 0); agent_tokens, integration_tokens and
// connector_permissions of this user; approval_request rows this user
// requested that are still pending; inbox_items this user triggered in OTHER
// users' inboxes (they carry an excerpt of this user's text).
// agent_memory_entries this user created without a project or inside a
// project this user owns, except GLOBAL-scope entries (the creator foreign
// key is SetNull now, so these need their own deleteMany).
// REMOVED by an onDelete: Cascade foreign key: room_participants,
// message_reactions, typing_status, user_secrets, user_file_sources,
// user_plugin_preferences, this user's inbox, and projects this user owns
// with everything inside them (tasks, whoever created them, plugin module
// instances and runs, plugin links, attachments, agent memory entries).
// REMOVED AFTER THE COMMIT, best effort: the upload files of the project and
// task attachments that went with this user's own projects (see
// unlinkDeletedUploadFiles).
// REASSIGNED: tasks.assignedTo naming this user on tasks in projects this
// user does not own goes to that project's owner, with one task-scoped
// agent_audit_log row per task as the timeline note.
// ANONYMISED (the row stays, the reference or the personal text goes):
// tasks.createdBy, plugin_module_instances.createdBy,
// plugin_module_runs.startedBy, project_plugin_links.linkedBy,
// project_attachments.uploadedBy and agent_memory_entries.createdBy on rows
// inside OTHER owners' projects (all SetNull: the row stays, the creator is
// gone; readers render a null creator as a deleted user), and
// agent_memory_entries.createdBy on GLOBAL-scope entries wherever they sit
// outside this user's own projects (kept by operator decision);
// agent_audit_log (agentId SetNull, `details` scrubbed, see below);
// invite_codes.createdById (SetNull), usedById on every code this user
// redeemed, and note on used codes this user created and on single-use codes
// (maxUses = 1) this user redeemed; approval_request
// requestedBy (SetNull), decidedBy and decisionNote; tasks.reviewedBy;
// this id inside projects.teamMemberIds and agent_tokens.sharedWith;
// messages.senderId and pinnedById, agent_memory_entries.updatedBy and
// plugin_installations.updatedBy (all SetNull); this user's entry in
// data/mention-limits.json (after the commit). The scrubs of columns without
// a foreign key (usedById, decidedBy, reviewedBy, teamMemberIds, sharedWith)
// remove the id at deletion time only: a later or stale write that names the
// id again is not prevented.
// KEPT, with the reason: message content and message attachments (other
// people's rooms; under review); names and descriptions of rooms this user
// typed (rooms have no owner column; under review); threads.createdBy
// (nothing in server/src writes it); text this user edited into
// other owners' tasks (the project owner's data); task_attachments
// uploadedBy and filename; the upload files of attachment rows that stay
// (including those this user uploaded into other owners' projects);
// project_secrets.createdBy on other owners'
// projects (under review); connector_permissions.grantedBy (the record of who
// authorised an agent); web_hook_configs.reviewerAgentId (nothing in
// server/src writes it);
// the agent User rows this user registered, deactivated but with their
// username and displayName (under review); invite_codes.note on UNUSED codes
// other users created that merely contain this user's email (free-text
// matching is not attempted), and on multi-use codes another user created
// that this user only redeemed (the note is the creator's label for the
// whole code, and the code stays active); the agent_audit_log residuals named below; log
// files (winston, rotated by size), Redis message cache (one hour TTL) and
// presence set, database backups (retention per
// scripts/backup.sh), posts already sent to Microsoft Teams, and anything a
// client stored locally (not inspected).
router.delete('/me', authenticate, async (req, res) => {
  const userId = req.user!.id;
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password confirmation required to delete account.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (!user.passwordHash) return res.status(400).json({ error: 'Account has no password (AI agent?).' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(403).json({ error: 'Incorrect password.' });

    // agent_audit_log rows are anonymised, not deleted or cascaded:
    // AgentAuditLog.agentId is nullable with onDelete: SetNull (see
    // docs/okf/prisma-data-model-invariants.md, Invariant 6). That FK rule
    // only nulls agentId, so this same transaction also scrubs, out of
    // `details`, what this task's own scope covers:
    //   (a) every row this user wrote (agentId = userId) gets `details` set
    //       to JSON null -- `details` is free-form and action-defined (a
    //       task title, a screening run's title, an approval's decision
    //       note, an attachment's filename), and the source row it was
    //       copied from can itself be cascade-deleted with this user,
    //       leaving the audit copy as the only surviving one;
    //   (b) every OTHER row (written by a different, still-present user)
    //       that names this user's id inside `details` -- currently only
    //       `assignedTo`, which has two writers: routes/projects.ts's
    //       task-update audit call (the new assignee, whoever ran the
    //       PATCH), and the task.assignee_reassigned rows this
    //       transaction inserts when an assignee deletes their account
    //       (those carry the project owner's id, which a later self-delete
    //       of that owner scrubs here as well), after
    //       checking every logAuditEvent/withAudit call site in server/src
    //       for a details key that can hold a user id -- has that key
    //       removed via the jsonb `-` operator, leaving the row's own
    //       agentId (the other, still-present user, or null for the
    //       reassignment rows) untouched.
    // This does NOT scrub user-authored text that this user typed into a
    // resource someone else owns, then got copied into that OTHER actor's
    // own audit row (for example, an attachment's filename this user
    // uploaded, audited under the reading agent's own agentId by
    // routes/agents.ts's attachment.read, or the title of a project this
    // user created that was cascade-deleted with them but whose audit
    // trail was written by a different actor): that class is kept, see
    // docs/okf/self-delete-data-retention.md. Message content is
    // unaffected either way (messages.senderId is onDelete: SetNull, so
    // the message row and its content survive); a room's own name, which
    // this user may have typed, is unaffected by this scrub for the same
    // reason (rooms are not deleted or scrubbed here). The first statement
    // below also takes a row lock on this user, closing the race where an
    // audit row written BY this user (agentId FK) could otherwise still be
    // inserted in the gap between the scrub statements and the delete (see
    // Invariant 6). It does NOT close the symmetric race on the other
    // scrub statement: another actor's late task.update audit row, or a
    // concurrent departing user's task.assignee_reassigned row, whose
    // `details.assignedTo` names this user has no FK to lock, so it can
    // still land after the scrub runs (kept, listed in
    // docs/okf/self-delete-data-retention.md).
    // The six remaining RESTRICT foreign keys to users named in Invariant 6's
    // residual (invite_codes.createdById, agent_tokens.createdById,
    // integration_tokens.createdBy, connector_permissions.userId,
    // mcp_connections.createdBy, approval_request.requestedBy) are closed by
    // task eb405d43: per relation, either an explicit delete below (the FK
    // itself stays RESTRICT; the offending rows are gone before
    // `user.delete` runs), an explicit deactivation, or, for invite_codes
    // and approval_request, a schema change (nullable column,
    // `onDelete: SetNull`, migration
    // 20260923094230_self_delete_restrict_fks_invite_and_approval) so the
    // still-useful "used"/"decided" row survives with the FK nulled instead
    // of being deleted:
    //   - invite_codes created by this user: UNUSED (useCount = 0)
    //     deleted below; USED (useCount > 0, single- or multi-use) kept but
    //     deactivated (isActive: false below, so a multi-use code with
    //     unused redemptions left cannot be redeemed again once its creator
    //     is gone), createdById nulled by the FK when `user.delete` runs (it
    //     stays as the record that the code was redeemed; the redeemer's id
    //     and the note are anonymised by the personal-data scrubs below,
    //     which do not change what counts as used, because used means
    //     useCount > 0).
    //   - agent_tokens, integration_tokens and connector_permissions
    //     created by / belonging to this user: deleted below (credential-
    //     like; never left valid without an owner -- deleting an agent_tokens
    //     row also revokes the bearer token of any BYOA agent this user
    //     registered, even one still shared with other users). integration_tokens
    //     matches EITHER createdBy OR userId below: a token another user
    //     created but assigned to this user (userId) would otherwise survive
    //     with userId nulled by that column's own onDelete: SetNull, turning
    //     a per-user token into a tenant-wide one visible to
    //     tokenManager.getToken()'s `userId: null` lookup.
    //   - the agent's own User row for every agent_tokens row this user
    //     registered (createdById) is set isActive: false below, in the
    //     same transaction, before its token row is deleted (identifying it
    //     needs the token row's userId column, which the later
    //     agentToken.deleteMany removes): the registrar's departure already
    //     revokes the agent's ability to authenticate (byoaAuth.ts and
    //     middleware/auth.ts both require a live, active agent_tokens row),
    //     but leaving the agent's own account isActive: true kept it
    //     looking live everywhere else it still appears (room membership,
    //     connector permissions) with no way back in.
    //   - mcp_connections created by this user are left untouched: an
    //     admin-owned, org-wide connection (used by every agent, not just
    //     this user) would otherwise be destroyed by that admin's own self-
    //     delete. mcp_connections.createdBy stays RESTRICT, so
    //     `prisma.user.delete` below fails with Prisma P2003 if this user
    //     still owns any -- classified below as its own 409
    //     (`owns_mcp_connections`) instead of the generic constraint-failure
    //     branch, telling the caller to transfer or remove them first. This
    //     needs no separate check statement: it is the pre-existing FK,
    //     evaluated by Postgres as part of this same transaction, strictly
    //     after the `FOR UPDATE` lock below -- which is also what makes it
    //     race-safe rather than a separate check-then-act: a concurrent
    //     mcp_connections insert naming this user takes a `FOR KEY SHARE`
    //     lock on the referenced "users" row to verify its own FK, which
    //     conflicts with the held `FOR UPDATE` lock and blocks until this
    //     transaction commits or rolls back, so it either becomes visible to
    //     this transaction's own `user.delete` check (blocking the delete),
    //     or its insert proceeds only after this user no longer exists, and
    //     then fails its own FK check instead.
    //   - approval_request from this user: PENDING deleted below; a
    //     DECIDED (approved/rejected) one is kept, requestedBy nulled by
    //     the FK when `user.delete` runs (it stays as the record that a
    //     decision was made; decidedBy and decisionNote are anonymised by
    //     the personal-data scrubs below).
    //
    // Runs as a batch `$transaction([...])`, not an interactive
    // `$transaction(async (tx) => ...)`: none of these statements depends
    // on a prior statement's result, and Prisma's interactive-transaction
    // form applies a default 5s wall-clock timeout to the whole callback
    // (configurable, but still a cap), which a heavy-history account's
    // cascade could exceed; the batch array form executes as a single
    // native DB transaction with no such timeout (see prisma/client's
    // generated `$transaction` overload: the batch signature's options
    // type carries only `isolationLevel`, no `maxWait`/`timeout`, unlike
    // the callback signature). Every explicit delete below must run BEFORE
    // `prisma.user.delete` in this array: Postgres checks each statement's
    // foreign keys immediately (not deferred), so a still-RESTRICT relation
    // (agent_tokens, integration_tokens, connector_permissions) would still
    // block `user.delete` if its rows were not already gone by the time
    // that statement runs. The agent-user deactivation raw UPDATE must run
    // BEFORE `agentToken.deleteMany` specifically (not merely before
    // `user.delete`): its subquery reads `agent_tokens.userId` for rows
    // `createdById = userId`, which the deleteMany statement right after it
    // removes; under READ COMMITTED a transaction sees its own prior
    // statements' writes, so running it after the deleteMany would find no
    // rows left to deactivate.
    // Upload URLs of the attachments that go with the projects this user owns,
    // read INSIDE the transaction (results index 1 and 2 below), before
    // anything is deleted: the rows are gone after the commit, so this is the
    // only place the file names can be collected. Attachments this user
    // uploaded into OTHER owners' projects are not listed: those rows stay.
    const ownedProjectAttachmentUrlsQuery = prisma.projectAttachment.findMany({
      where: { project: { ownerId: userId } },
      select: { url: true },
    });
    const ownedTaskAttachmentUrlsQuery = prisma.taskAttachment.findMany({
      where: { task: { project: { ownerId: userId } } },
      select: { url: true },
    });
    const txResults = await prisma.$transaction([
      prisma.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`,
      ownedProjectAttachmentUrlsQuery,
      ownedTaskAttachmentUrlsQuery,
      prisma.agentAuditLog.updateMany({
        where: { agentId: userId },
        data: { details: Prisma.JsonNull },
      }),
      prisma.$executeRaw`
        UPDATE "agent_audit_log"
        SET details = details - 'assignedTo'
        WHERE "agentId" IS DISTINCT FROM ${userId}
          AND details ->> 'assignedTo' = ${userId}
      `,
      // Keyed on `useCount: 0`, the complement of the deactivation below
      // (`useCount > 0`), not on `usedById`: the personal-data scrub further
      // down nulls usedById on codes a deleting user redeemed, and a used
      // code must still count as used when its creator deletes later.
      prisma.inviteCode.deleteMany({
        where: { createdById: userId, useCount: 0 },
      }),
      prisma.inviteCode.updateMany({
        where: { createdById: userId, useCount: { gt: 0 } },
        data: { isActive: false },
      }),
      prisma.$executeRaw`
        UPDATE "users"
        SET "isActive" = false
        WHERE id IN (SELECT "userId" FROM "agent_tokens" WHERE "createdById" = ${userId})
      `,
      prisma.agentToken.deleteMany({ where: { createdById: userId } }),
      prisma.integrationToken.deleteMany({
        where: { OR: [{ createdBy: userId }, { userId }] },
      }),
      prisma.connectorPermission.deleteMany({ where: { userId } }),
      prisma.approvalRequest.deleteMany({
        where: { requestedBy: userId, status: 'pending' },
      }),
      // Personal-data scrubs for columns that hold this user's id or text
      // WITHOUT a foreign key (or whose SetNull would leave the text behind);
      // see the "what DELETE /me keeps" block above. Each runs before
      // `user.delete`.
      // invite_codes.note is free text that can hold an email (the invitee
      // on a code this user created, this user's own email on a single-use
      // code they redeemed). Two halves: codes this user CREATED that
      // survived the unused-code deleteMany above (used ones), and
      // single-use codes (maxUses = 1) this user REDEEMED, where the note was
      // written about the one redeemer. A multi-use code someone else
      // created keeps its note when this user was only the latest redeemer:
      // the note is that creator's label for the whole code, can carry
      // project routing, and the code stays active. This has to run BEFORE
      // the usedById scrub below, because its second half matches on
      // `usedById = userId`.
      prisma.inviteCode.updateMany({
        where: {
          OR: [{ createdById: userId }, { usedById: userId, maxUses: 1 }],
        },
        data: { note: null },
      }),
      // The id of the person who redeemed a code is a plain string with no
      // FK. It is nulled on every code this user redeemed, single-use or
      // not. Which codes count as used does not depend on it: the
      // unused-code deleteMany and the deactivation above key on useCount.
      prisma.inviteCode.updateMany({
        where: { usedById: userId },
        data: { usedById: null },
      }),
      // The decider and the decision note are plain strings; the row, its
      // status and decidedAt stay as the record that a decision was made.
      prisma.approvalRequest.updateMany({
        where: { decidedBy: userId },
        data: { decidedBy: null, decisionNote: null },
      }),
      // tasks.reviewedBy is a plain nullable string on tasks that may belong
      // to other owners' projects; null means "no reviewer" to the reviewer
      // resolver.
      prisma.task.updateMany({
        where: { reviewedBy: userId },
        data: { reviewedBy: null },
      }),
      // Plain string arrays with no FK: drop this user's id from other
      // owners' member and sharing lists.
      prisma.$executeRaw`
        UPDATE "projects"
        SET "teamMemberIds" = array_remove("teamMemberIds", ${userId})
        WHERE ${userId} = ANY("teamMemberIds")
      `,
      prisma.$executeRaw`
        UPDATE "agent_tokens"
        SET "sharedWith" = array_remove("sharedWith", ${userId})
        WHERE ${userId} = ANY("sharedWith")
      `,
      // Inbox items this user triggered sit in OTHER users' inboxes and carry
      // an excerpt of this user's text (title/message). inbox_items.actorId is
      // onDelete: SetNull, which would erase only the key and leave the text,
      // so these rows are deleted here, BEFORE `user.delete` fires the
      // SetNull. Items in this user's own inbox (recipientId) cascade.
      prisma.inboxItem.deleteMany({ where: { actorId: userId } }),
      // Agent memory entries this user created that are not inside someone
      // else's project and are not GLOBAL: without a project, or inside a
      // project this user owns. The creator foreign key is SetNull now (so an
      // entry in ANOTHER owner's project survives with createdBy null), which
      // means it would also keep these rows with the creator nulled; they are
      // this user's own data and are removed here, before `user.delete`.
      // GLOBAL-scope entries are shared knowledge across projects: by operator
      // decision they stay, with createdBy nulled by the foreign key like a
      // row in another owner's project (a GLOBAL entry that sits inside one of
      // this user's own projects still goes with that project).
      prisma.agentMemoryEntry.deleteMany({
        where: {
          createdBy: userId,
          scope: { not: 'GLOBAL' },
          OR: [{ projectId: null }, { project: { ownerId: userId } }],
        },
      }),
      // tasks.assignedTo is a required plain string with no foreign key. A task
      // in a project this user does NOT own that is assigned to this user goes
      // to that project's owner (the project owner's data stays usable), and
      // each such task gets one task-scoped agent_audit_log row as the
      // timeline note. The row carries the new assignee (the owner) and a
      // reason, never the deleted user's id, and agentId stays null. One
      // statement so the audit rows are exactly the reassigned tasks. Tasks in
      // projects this user owns are excluded: they are deleted with the
      // project below. updatedAt is bumped by hand (raw SQL skips @updatedAt).
      prisma.$executeRaw`
        WITH reassigned AS (
          UPDATE "tasks" t
          SET "assignedTo" = p."ownerId", "updatedAt" = now()
          FROM "projects" p
          WHERE t."projectId" = p.id
            AND t."assignedTo" = ${userId}
            AND p."ownerId" <> ${userId}
          RETURNING t.id AS "taskId", t."projectId" AS "projectId", p."ownerId" AS "ownerId"
        )
        INSERT INTO "agent_audit_log"
          (id, "timestamp", "agentId", action, "resourceType", "resourceId", "projectId", details, success)
        SELECT
          gen_random_uuid()::text, now(), NULL, 'task.assignee_reassigned', 'task',
          "taskId", "projectId",
          jsonb_build_object('reason', 'assignee_account_deleted', 'assignedTo', "ownerId"),
          true
        FROM reassigned
      `,
      prisma.user.delete({ where: { id: userId } }),
    ]);
    const ownedAttachmentUrls = [
      ...txResults[1].map((row) => row.url),
      ...txResults[2].map((row) => row.url),
    ];
    // Best effort, strictly after the commit: the per-user mention counter
    // lives in a JSON file, not the database, so it cannot join the
    // transaction. A failure here must not fail a deletion that already
    // committed. The error text is part of the log MESSAGE (see the catch
    // block below for why metadata objects are dropped).
    try {
      await removeMentionLimitEntry(userId);
    } catch (err) {
      logger.warn(
        `Account deleted but its mention-limits entry could not be removed: userId=${userId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Same best-effort rule for the upload files of the attachments that were
    // deleted with this user's own projects (see unlinkDeletedUploadFiles).
    try {
      await unlinkDeletedUploadFiles(ownedAttachmentUrls, userId);
    } catch (err) {
      logger.warn(
        `Account deleted but its upload files could not be cleaned up: userId=${userId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      // mcp_connections.createdBy is the one RESTRICT relation this
      // transaction deliberately never clears (see the comment above the
      // transaction array): distinguish it from every other constraint
      // failure so the caller gets an actionable, translated-neutral code
      // instead of the generic message below.
      const fieldName = err.meta?.field_name;
      if (typeof fieldName === 'string' && fieldName.includes('mcp_connections_createdBy_fkey')) {
        logger.error(
          `Account deletion blocked: userId=${userId} still owns mcp_connections rows (code=${err.code} meta=${JSON.stringify(err.meta)})`,
        );
        return res.status(409).json({
          error:
            'Account could not be deleted because you still own one or more MCP connections. Transfer ownership or remove them first.',
          code: 'owns_mcp_connections',
        });
      }
      // A known constraint failure: some other relation still references this
      // user and has no onDelete rule to resolve it (unlike agent_audit_log's
      // agentId, which no longer blocks this path). Surface it as a 409,
      // instead of masking every failure as an opaque 500, with the Prisma
      // error code and a summary of `err.meta` written into the log MESSAGE
      // itself, not just passed as a metadata object -- utils/logger.ts's
      // `printf` formatter destructures only
      // `{ level, message, timestamp, stack }` from each log call, so any
      // extra metadata object is silently dropped from every written line
      // (console and both file transports).
      logger.error(
        `Account deletion blocked by a foreign key constraint: userId=${userId} code=${err.code} meta=${JSON.stringify(err.meta)}`,
      );
      return res.status(409).json({
        error: 'Account could not be deleted because related data still references it.',
        code: err.code,
      });
    }
    // Same reasoning as the 409 arm above: the error's own message has to be
    // part of the log call's MESSAGE argument, not a separate metadata
    // object, or utils/logger.ts's printf formatter drops it from the
    // written line.
    logger.error(
      `Failed to delete account: userId=${userId} error=${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// Public config endpoint — tells the frontend what registration mode is active
router.get('/config', (_req, res) => {
  res.json({ registrationMode: REGISTRATION_MODE });
});

// Real-time username availability check (no auth needed, used in register form)
router.get('/check-username', async (req, res) => {
  const raw = (req.query.username as string ?? '').toLowerCase().trim();
  if (!raw || raw.length < 3) {
    return res.json({ available: false, reason: 'too_short' });
  }
  const existing = await prisma.user.findUnique({ where: { username: raw } });
  res.json({ available: !existing });
});

export { router as authRoutes };
