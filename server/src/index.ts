import * as Sentry from "@sentry/node";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { createClient } from "redis";

import path from "path";
import prisma from "./lib/prisma";
import { authRoutes } from "./routes/auth";
import { messageRoutes } from "./routes/messages";
import { userRoutes } from "./routes/users";
import { roomRoutes } from "./routes/rooms";
import adminRoutes from "./routes/admin";
import { agentRoutes } from "./routes/agents";
import { uploadRoutes } from "./routes/upload";
import { projectRoutes } from "./routes/projects";
import secretsRouter from "./routes/secrets";
import { batchRoutes } from "./routes/batch";
import { inboxRoutes } from "./routes/inbox";
import { memoryRoutes } from "./routes/memory";
import { pluginRoutes } from "./routes/plugins";
import { connectorRoutes } from "./connectors/proxy";
import integrationRoutes from "./routes/integrations";
import { userFilesRoutes } from "./routes/userFiles";
import approvalsRouter from "./routes/approvals";
import { socketHandler } from "./services/socketService";
import { startAutoRefresh } from "./services/tokenManager";
import { initConnectors } from "./connectors/registry";
import { startMcpHealthCheck } from "./connectors/mcp/mcpHealthCheck";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import { validateEnvironment } from "./utils/env-validation";
import { pluginManager } from "./plugins/manager";
import { builtinPlugins } from "./plugins/builtin";
import { teamsRoutes } from './integrations/teams/teamsBot';

dotenv.config();

// Sentry — must init before any other imports that might throw
const sentryDsn = process.env.SENTRY_DSN;
const sentryEnabled =
  process.env.NODE_ENV !== "development" && Boolean(sentryDsn);

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV ?? "production",
    enabled: true,
    tracesSampleRate: 0.1,
  });
}

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

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

pluginManager.initialize(
  {
    prisma,
    io,
    redis,
    logger,
  },
  builtinPlugins,
);

// Auth-gated file serving — see routes/files.ts
import { fileRoutes } from "./routes/files";
// Legacy static serving removed for security — files require room membership

app.use(helmet());

const CORS_ORIGIN = process.env.CLIENT_URL || "http://localhost:4000";
if (!process.env.CLIENT_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "⚠️  CLIENT_URL not set in production — CORS defaults to localhost",
  );
}
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      const originalUrl = (req as { originalUrl?: string }).originalUrl;
      if (originalUrl?.startsWith("/api/rooms/webhooks/github")) {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Global API rate limit — 100 req/min per IP (auth routes have stricter limits)
const globalRateLimitMax = Number(
  process.env.GLOBAL_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 600 : 2000),
);
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max:
    Number.isFinite(globalRateLimitMax) && globalRateLimitMax > 0
      ? globalRateLimitMax
      : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Mounted at /api -> req.path starts with "/..."
  skip: (req) =>
    req.path === "/agents/message" || // BYOA agents exempt (they have token auth)
    req.path === "/auth/config" ||
    req.path === "/agents/info" ||
    req.path === "/health",
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
app.use("/api/projects", projectRoutes);
app.use("/api/secrets", secretsRouter);
app.use("/api/batch", batchRoutes);
app.use("/api/inbox", inboxRoutes);
app.use("/api/memory", memoryRoutes);
app.use("/api/plugins", pluginRoutes);
app.use("/api/connectors", connectorRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/user-files", userFilesRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/approvals", approvalsRouter);
pluginManager.mountRoutes(app);

const openApiSpecPath = path.resolve(__dirname, "../openapi.yaml");
app.get("/api/openapi.yaml", (_req, res) => {
  res.type("application/yaml");
  res.sendFile(openApiSpecPath, (error: NodeJS.ErrnoException | null) => {
    if (error && !res.headersSent) {
      logger.error("Failed to serve OpenAPI spec:", error);
      res
        .status((error as NodeJS.ErrnoException & { statusCode?: number }).statusCode || 500)
        .json({ error: "OpenAPI spec unavailable" });
    }
  });
});

app.get("/api/docs", (_req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; font-src 'self' data: https://unpkg.com; connect-src 'self';",
  );
  res.setHeader("X-Robots-Tag", "noindex");
  res.type("html");
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenTriologue API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout",
      });
    </script>
  </body>
</html>`);
});

// Health check
app.get("/api/health", (_req, res) => {
  void _req;
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
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app);
}
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
      initConnectors();
      startAutoRefresh();
      startMcpHealthCheck();
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

// Only boot the HTTP server when this module is run directly (e.g.
// `node dist/index.js`). Importing the module must NOT boot the HTTP server,
// so server route tests can `import { app } from "../index"` without binding a
// port or tripping startServer's process.exit when Redis/DB are unavailable.
// (Other import-time work like validateEnvironment/pluginManager still runs;
// only the server boot is gated here.)
if (require.main === module) {
  startServer();
}

export { app, io, prisma, redis };
