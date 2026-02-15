import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import Redis from 'redis';

import { authRoutes } from './routes/auth';
import { messageRoutes } from './routes/messages';
import { userRoutes } from './routes/users';
import { socketHandler } from './services/socketService';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:4000",
    methods: ["GET", "POST"]
  }
});

// Database connection
const prisma = new PrismaClient();
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:4000",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Socket.io connection handling
socketHandler(io, prisma, redis);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Connect to Redis
    await redis.connect();
    logger.info('✅ Connected to Redis');

    // Test database connection
    await prisma.$connect();
    logger.info('✅ Connected to database');

    server.listen(PORT, () => {
      logger.info(`🚀 Triologue server running on port ${PORT}`);
      logger.info(`📡 WebSocket server ready`);
      logger.info(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:4000'}`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🔄 Shutting down gracefully...');
  await prisma.$disconnect();
  await redis.disconnect();
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

startServer();

export { app, io, prisma, redis };