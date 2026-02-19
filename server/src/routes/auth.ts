import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserType } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { userSchemas, validate, sanitize } from '../utils/validation';
import { authenticate, requireHuman } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Rate limiting configurations
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // AI agents with valid tokens don't need rate limiting — they use long-lived JWTs
  skip: (req) => {
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
});

// Registration endpoint
router.post('/register', registerLimit, validate(userSchemas.register), async (req, res) => {
  try {
    const { username, email, password, displayName, userType, inviteCode } = req.body;

    const registrationMode = process.env.REGISTRATION_MODE ?? 'open'; // open | invite | closed

    if (registrationMode === 'closed' && userType === 'HUMAN') {
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
    if (registrationMode === 'invite' && userType === 'HUMAN') {
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
    if (registrationMode === 'invite' && inviteCode && userType === 'HUMAN') {
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

    // Return user without sensitive data
    const { passwordHash: _, ...safeUser } = user;
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
    if (userType === 'AI_ICE' || userType === 'AI_LAVA' || userType === 'AI_OTHER') {
      // AI authentication with token
      if (!aiToken) {
        return res.status(400).json({ error: 'AI token required for AI users' });
      }

      // Validate AI token - fail fast if environment variables missing
      const expectedTokens = {
        'AI_ICE': process.env.ICE_TOKEN,
        'AI_LAVA': process.env.LAVA_TOKEN,
        'AI_OTHER': process.env.AI_OTHER_TOKEN
      };

      const expectedToken = expectedTokens[userType as keyof typeof expectedTokens];
      if (!expectedToken) {
        console.error(`Missing environment variable for ${userType}: ${userType}_TOKEN`);
        return res.status(500).json({ error: 'Authentication configuration error' });
      }

      if (aiToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid AI token' });
      }

      // Verify user type matches
      if (user.userType !== userType) {
        return res.status(401).json({ error: 'User type mismatch' });
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
    const { passwordHash, authToken, ...safeUser } = user;
    res.json({ 
      message: 'Login successful',
      user: safeUser, 
      token 
    });
  } catch (error) {
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // Return user without sensitive data
    const { passwordHash, authToken, ...safeUser } = user;
    res.json({ 
      valid: true,
      user: safeUser 
    });
  } catch (error) {
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      // Update last seen time
      await prisma.user.update({
        where: { id: decoded.userId },
        data: { lastSeen: new Date() }
      });
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
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
    const { passwordHash, authToken, ...profile } = user;
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
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Update own profile (displayName, password)
router.patch('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { displayName, currentPassword, newPassword } = req.body;
    const updates: any = {};

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
    const { passwordHash: _, ...safe } = updated;
    res.json({ message: 'Profile updated.', user: safe });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Delete own account (GDPR — cascades messages, participants, etc.)
router.delete('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    // Cascade: Prisma onDelete handles messages, room_participants, reactions
    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// Public config endpoint — tells the frontend what registration mode is active
router.get('/config', (_req, res) => {
  const registrationMode = process.env.REGISTRATION_MODE ?? 'open';
  res.json({ registrationMode });
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