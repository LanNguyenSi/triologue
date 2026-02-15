import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password, userType } = req.body;

    // For AI users, use token-based authentication
    if (userType === 'AI_ICE' || userType === 'AI_LAVA') {
      // TODO: Implement AI token authentication
      const user = await prisma.user.findUnique({
        where: { username }
      });

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, userType: user.userType },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      res.json({ user, token });
    } else {
      // Human user authentication
      const user = await prisma.user.findUnique({
        where: { username }
      });

      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, userType: user.userType },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' }
      );

      res.json({ user: { ...user, passwordHash: undefined }, token });
    }
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Token validation
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

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({ user: { ...user, passwordHash: undefined } });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export { router as authRoutes };