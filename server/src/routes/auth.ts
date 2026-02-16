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
    const { username, email, password, displayName, userType } = req.body;

    // Sanitize inputs
    const cleanUsername = sanitize.username(username);
    const cleanEmail = sanitize.email(email);
    const cleanDisplayName = sanitize.displayName(displayName);

    // Check if user already exists
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
          ? 'Username already taken'
          : 'Email already registered'
      });
    }

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
        isActive: true
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        userType: user.userType 
      },
      process.env.JWT_SECRET!,
      { expiresIn: userType === 'HUMAN' ? '7d' : '24h' }
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

      // Validate AI token (simple implementation for now)
      const expectedTokens = {
        'AI_ICE': process.env.ICE_TOKEN || 'ice-token-2026',
        'AI_LAVA': process.env.LAVA_TOKEN || 'lava-token-2026',
        'AI_OTHER': process.env.AI_OTHER_TOKEN || 'ai-other-token-2026'
      };

      if (aiToken !== expectedTokens[userType as keyof typeof expectedTokens]) {
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
      { expiresIn: userType === 'HUMAN' ? '7d' : '24h' }
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

export { router as authRoutes };