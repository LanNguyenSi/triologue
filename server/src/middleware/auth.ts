import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        userType: string;
        displayName: string;
        isAdmin?: boolean;
      };
    }
  }
}

// Authentication middleware
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // BYOA agent auth: allow agents to call regular authenticated APIs
    if (token.startsWith('byoa_')) {
      const agentToken = await (prisma as any).agentToken.findUnique({
        where: { token },
        include: {
          agentUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
              userType: true,
              isActive: true,
              isAdmin: true,
            },
          },
        },
      });

      if (!agentToken || !agentToken.isActive || agentToken.status !== 'active' || !agentToken.agentUser?.isActive) {
        return res.status(401).json({ error: 'Invalid or inactive agent token' });
      }

      req.user = {
        id: agentToken.agentUser.id,
        username: agentToken.agentUser.username,
        userType: agentToken.agentUser.userType,
        displayName: agentToken.agentUser.displayName,
        isAdmin: agentToken.agentUser.isAdmin,
      };

      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    // Add user info to request
    req.user = {
      id: user.id,
      username: user.username,
      userType: user.userType,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (user && user.isActive) {
        req.user = {
          id: user.id,
          username: user.username,
          userType: user.userType,
          displayName: user.displayName
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Admin/Owner authorization
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // For now, treat HUMAN users as potential admins
  // In the future, add proper role management
  if (req.user.userType !== 'HUMAN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

// Human users only
export const requireHuman = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.userType !== 'HUMAN') {
    return res.status(403).json({ error: 'Human user access required' });
  }
  next();
};

// AI users only
export const requireAI = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(req.user.userType)) {
    return res.status(403).json({ error: 'AI agent access required' });
  }
  next();
};
