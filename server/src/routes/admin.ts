/**
 * Admin Routes — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import crypto from 'crypto';
import prisma from '../lib/prisma';

const router = Router();
const DEFAULT_USER_LIMIT = 12;
const MAX_USER_LIMIT = 100;

// Middleware: require admin
const requireAdmin = async (req: any, res: any, next: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /admin/users — list all users with AI trigger status
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? DEFAULT_USER_LIMIT), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, MAX_USER_LIMIT))
      : DEFAULT_USER_LIMIT;
    const rawPage = Number.parseInt(String(req.query.page ?? 1), 10);
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
    const skip = (page - 1) * limit;

    const [totalCount, users] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          displayName: true,
          userType: true,
          isAdmin: true,
          canTriggerAI: true,
          isActive: true,
          createdAt: true,
          lastSeen: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const hasMore = page < totalPages;

    // Keep `users` for backward compatibility; new clients can use pagination metadata.
    res.json({
      users,
      items: users,
      totalCount,
      pageInfo: {
        page,
        limit,
        totalPages,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /admin/users/:username/ai-trigger — toggle canTriggerAI
router.patch('/users/:username/ai-trigger', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const { canTriggerAI } = req.body;

    if (typeof canTriggerAI !== 'boolean') {
      return res.status(400).json({ error: 'canTriggerAI must be boolean' });
    }

    const user = await prisma.user.update({
      where: { username },
      data: { canTriggerAI },
      select: { username: true, canTriggerAI: true },
    });

    res.json({ success: true, user });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /admin/invite-codes — list all invite codes
router.get('/invite-codes', authenticate, requireAdmin, async (req, res) => {
  try {
    const codes = await prisma.inviteCode.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ codes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch invite codes' });
  }
});

// POST /admin/invite-codes — create new invite code
router.post('/invite-codes', authenticate, requireAdmin, async (req, res) => {
  try {
    const { maxUses = 1, expiresInDays } = req.body;

    const code = crypto.randomBytes(6).toString('hex').toUpperCase(); // e.g. A1B2C3
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdById: req.user?.id || '',
        maxUses: Number(maxUses),
        expiresAt,
      },
    });

    res.status(201).json({ invite });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// DELETE /admin/invite-codes/:code — delete invite code
router.delete('/invite-codes/:code', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.inviteCode.delete({ where: { code: req.params.code } });
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Code not found' });
    res.status(500).json({ error: 'Failed to delete code' });
  }
});

export default router;
