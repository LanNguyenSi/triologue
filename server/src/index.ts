import * as Sentry from "@sentry/node";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";

import path from "path";
import { authRoutes } from "./routes/auth";
import { messageRoutes } from "./routes/messages";
import { userRoutes } from "./routes/users";
import { roomRoutes } from "./routes/rooms";
import adminRoutes from "./routes/admin";
import { agentRoutes } from "./routes/agents";
import { uploadRoutes } from "./routes/upload";
import { socketHandler } from "./services/socketService";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import { validateEnvironment } from "./utils/env-validation";

dotenv.config();

// Sentry — must init before any other imports that might throw
Sentry.init({
  dsn: "https://e93bbd9a453cf2cf1f623691fe295bc4@o4510914290384896.ingest.de.sentry.io/4510914300215376",
  environment: process.env.NODE_ENV ?? "production",
  enabled: process.env.NODE_ENV !== "development",
  tracesSampleRate: 0.1,
});

// Validate required environment variables on startup
validateEnvironment();

const app = express();
app.set("trust proxy", 1); // Trust Nginx/Traefik reverse proxy for correct IP detection
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:4000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

// Database connection
const prisma = new PrismaClient();
const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

// Auth-gated file serving — see routes/files.ts
import { fileRoutes } from "./routes/files";
// Legacy static serving removed for security — files require room membership

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:4000",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Global API rate limit — 100 req/min per IP (auth routes have stricter limits)
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/api/agents/message", // BYOA agents exempt (they have token auth)
});
app.use("/api", globalLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/users", userRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/files", fileRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

// Make io accessible from Express routes (e.g. for BYOA agent message broadcast)
app.set("io", io);

// Socket.io connection handling
socketHandler(io, prisma, redis);

// Error handling
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Connect to Redis
    await redis.connect();
    logger.info("✅ Connected to Redis");

    // Test database connection
    await prisma.$connect();
    logger.info("✅ Connected to database");

    server.listen(PORT, () => {
      logger.info(`🚀 Triologue server running on port ${PORT}`);
      logger.info(`📡 WebSocket server ready`);
      logger.info(
        `🌐 Client URL: ${process.env.CLIENT_URL || "http://localhost:4000"}`,
      );
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("🔄 Shutting down gracefully...");
  await prisma.$disconnect();
  await redis.disconnect();
  server.close(() => {
    logger.info("✅ Server closed");
    process.exit(0);
  });
});

startServer();

export { app, io, prisma, redis };
