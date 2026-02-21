import { Server as SocketIOServer, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  userType?: string;
}

interface TypingData {
  roomId: string;
  username: string;
  isTyping: boolean;
}

interface MessageData {
  content: string;
  roomId: string;
  threadId?: string;
  messageType?: string;
  researchTag?: string;
  aiContext?: any;
}

interface ReactionData {
  messageId: string;
  emoji: string;
}

export function socketHandler(
  io: SocketIOServer,
  prisma: PrismaClient,
  redis: any,
) {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive) {
        return next(new Error("User not found or inactive"));
      }

      socket.userId = user.id;
      socket.username = user.username;
      socket.userType = user.userType;

      next();
    } catch (error) {
      logger.error("Socket authentication error:", error);
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket: AuthenticatedSocket) => {
    logger.info(`🔌 User ${socket.username} (${socket.userType}) connected`);

    // Track online presence in Redis
    if (socket.userId) {
      await redis.sAdd("online_users", socket.userId);
    }

    // Update user's last seen
    if (socket.userId) {
      await prisma.user.update({
        where: { id: socket.userId },
        data: { lastSeen: new Date() },
      });
    }

    // Join user to their authorized rooms
    const userRooms = await prisma.roomParticipant.findMany({
      where: { userId: socket.userId },
      include: { room: true },
    });

    for (const participation of userRooms) {
      socket.join(participation.room.id);
      logger.info(
        `👥 ${socket.username} joined room: ${participation.room.name}`,
      );
    }

    // Join a room dynamically (e.g. after creating a new room)
    socket.on("room:join", async (data: { roomId: string }) => {
      try {
        const participation = await prisma.roomParticipant.findUnique({
          where: {
            userId_roomId: { userId: socket.userId!, roomId: data.roomId },
          },
        });
        if (participation) {
          socket.join(data.roomId);
          logger.info(
            `👥 ${socket.username} joined room dynamically: ${data.roomId}`,
          );
        }
      } catch (err) {
        logger.warn(`room:join failed for ${socket.username}: ${err}`);
      }
    });

    // Handle new message
    socket.on("message:send", async (data: MessageData) => {
      try {
        logger.info(
          `💬 Message from ${socket.username} in room ${data.roomId}`,
        );

        // Validate user is in room
        const participation = await prisma.roomParticipant.findUnique({
          where: {
            userId_roomId: {
              userId: socket.userId!,
              roomId: data.roomId,
            },
          },
        });

        if (!participation) {
          socket.emit("error", {
            message: "Not authorized to send messages in this room",
          });
          return;
        }

        // Create message
        const message = await prisma.message.create({
          data: {
            content: data.content,
            senderId: socket.userId!,
            roomId: data.roomId,
            threadId: data.threadId,
            messageType: (data.messageType as any) || "TEXT",
            researchTag: data.researchTag,
            aiContext: data.aiContext,
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                userType: true,
                avatar: true,
              },
            },
            reactions: {
              include: {
                user: {
                  select: { username: true, displayName: true },
                },
              },
            },
            attachments: true,
          },
        });

        // Update room activity
        await prisma.room.update({
          where: { id: data.roomId },
          data: {
            lastActivity: new Date(),
            messageCount: { increment: 1 },
          },
        });

        // Emit to room
        io.to(data.roomId).emit("message:new", message);

        // Store in Redis for caching
        await redis.setEx(
          `message:${message.id}`,
          3600,
          JSON.stringify(message),
        );

        // Trigger AI responses if needed
        await handleAIResponse(message, prisma, io, redis);
      } catch (error) {
        logger.error("Error sending message:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Handle typing indicators
    socket.on("typing:start", async (data: { roomId: string }) => {
      try {
        // Update typing status in database
        await prisma.typingStatus.upsert({
          where: {
            userId_roomId: {
              userId: socket.userId!,
              roomId: data.roomId,
            },
          },
          create: {
            userId: socket.userId!,
            roomId: data.roomId,
            isTyping: true,
          },
          update: {
            isTyping: true,
            updatedAt: new Date(),
          },
        });

        // Broadcast to room (except sender)
        socket.to(data.roomId).emit("typing:update", {
          username: socket.username,
          userType: socket.userType,
          isTyping: true,
        });
      } catch (error) {
        logger.error("Error updating typing status:", error);
      }
    });

    socket.on("typing:stop", async (data: { roomId: string }) => {
      try {
        await prisma.typingStatus.upsert({
          where: {
            userId_roomId: {
              userId: socket.userId!,
              roomId: data.roomId,
            },
          },
          create: {
            userId: socket.userId!,
            roomId: data.roomId,
            isTyping: false,
          },
          update: {
            isTyping: false,
            updatedAt: new Date(),
          },
        });

        socket.to(data.roomId).emit("typing:update", {
          username: socket.username,
          userType: socket.userType,
          isTyping: false,
        });
      } catch (error) {
        logger.error("Error stopping typing status:", error);
      }
    });

    // Handle message reactions
    socket.on("reaction:add", async (data: ReactionData) => {
      try {
        const reaction = await prisma.messageReaction.upsert({
          where: {
            messageId_userId_emoji: {
              messageId: data.messageId,
              userId: socket.userId!,
              emoji: data.emoji,
            },
          },
          create: {
            messageId: data.messageId,
            userId: socket.userId!,
            emoji: data.emoji,
          },
          update: {},
          include: {
            user: {
              select: { username: true, displayName: true },
            },
          },
        });

        // Get message to broadcast to correct room
        const message = await prisma.message.findUnique({
          where: { id: data.messageId },
          select: { roomId: true },
        });

        if (message) {
          io.to(message.roomId).emit("reaction:added", {
            messageId: data.messageId,
            reaction,
          });
        }
      } catch (error) {
        logger.error("Error adding reaction:", error);
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      logger.info(`❌ User ${socket.username} disconnected`);

      if (socket.userId) {
        // Only mark offline if this was the user's LAST socket connection
        // (daemon + send-message.ts can be connected simultaneously)
        const remainingSockets = [...io.sockets.sockets.values()].filter(
          (s: any) => s.userId === socket.userId && s.id !== socket.id,
        );
        if (remainingSockets.length === 0) {
          await redis.sRem("online_users", socket.userId);
        }

        // Update last seen
        await prisma.user.update({
          where: { id: socket.userId },
          data: { lastSeen: new Date() },
        });

        // Clear typing status
        await prisma.typingStatus.updateMany({
          where: { userId: socket.userId },
          data: { isTyping: false },
        });

        // Broadcast typing stop to all rooms
        for (const participation of userRooms) {
          socket.to(participation.room.id).emit("typing:update", {
            username: socket.username,
            userType: socket.userType,
            isTyping: false,
          });
        }
      }
    });
  });
}

// Handle AI auto-responses
async function handleAIResponse(
  message: any,
  prisma: PrismaClient,
  io: SocketIOServer,
  redis: any,
) {
  try {
    const content = message.content.toLowerCase();
    const senderType = message.sender.userType as string;
    const isHuman = senderType === "HUMAN";

    // ── canTriggerAI check (human users only) ──
    if (isHuman) {
      const senderUser = await prisma.user.findUnique({
        where: { id: message.senderId },
        select: { canTriggerAI: true },
      });
      if (!senderUser?.canTriggerAI) {
        logger.debug(
          `[webhook] User ${message.sender.username} has canTriggerAI=false — skipping`,
        );
        return;
      }

      // ── Per-user AI-trigger rate limit (max 5 pings per 5 min) ──
      const rateLimitKey = `ai_trigger:${message.senderId}`;
      const currentCount = await redis.incr(rateLimitKey);
      if (currentCount === 1) {
        await redis.expire(rateLimitKey, 5 * 60); // 5 minute window
      }
      if (currentCount > 5) {
        logger.warn(
          `[webhook] Rate limit hit for user ${message.sender.username} — skipping`,
        );
        return;
      }
    }

    const mentionsIce = content.includes("@ice");
    const mentionsLava = content.includes("@lava");

    // ── BYOA: Dispatch to external agents in this room FIRST ──────────────────
    // Do this before ice/lava check so BYOA agents get their webhooks even if @ice/@lava aren't mentioned
    if (isHuman) {
      try {
        const byoaAgents = await (prisma as any).agentToken.findMany({
          where: {
            isActive: true,
            agentUser: {
              participations: { some: { roomId: message.roomId } },
            },
          },
          include: { agentUser: { select: { id: true } } },
        });

        for (const byoa of byoaAgents) {
          // Skip if sender IS this agent (shouldn't happen since canTriggerAI=false, but safety check)
          if (byoa.userId === message.senderId) continue;

          // Trigger only on @mention of this agent's mentionKey
          const mentioned = content.includes(`@${byoa.mentionKey}`);
          if (!mentioned) continue;

          // Fetch context for this webhook
          const recentMessages = await prisma.message.findMany({
            where: { roomId: message.roomId, id: { not: message.id } },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { sender: { select: { username: true, userType: true } } },
          });
          const byoaContext = recentMessages.reverse().map((m: any) => ({
            sender: m.sender.username,
            senderType: m.sender.userType,
            content: m.content,
            timestamp: m.createdAt,
          }));

          const byoaBaseUrl = process.env.CLIENT_URL ?? "http://localhost:4000";
          const byoaAttachments = (message as any).attachments?.map((a: any) => ({
            id: a.id,
            filename: a.filename,
            url: `${byoaBaseUrl}${a.url}`,
            mimeType: a.mimeType,
            size: a.size,
            type: a.type,
          })) ?? [];

          const byoaPayload = JSON.stringify({
            messageId: message.id,
            sender: message.sender.username,
            senderType: message.sender.userType,
            content: message.content,
            room: message.roomId,
            timestamp: message.createdAt,
            attachments: byoaAttachments, // file metadata with full URLs
            context: byoaContext,
            agentToken: byoa.token, // Include token so agent can reply easily
            replyTo: `${process.env.API_URL ?? "http://localhost:3001"}/api/agents/message`,
          });

          const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
          fetch(byoa.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Triologue-Secret": webhookSecret,
              "X-Triologue-Agent": byoa.mentionKey,
            },
            body: byoaPayload,
          })
            .then(() =>
              logger.info(`[webhook:byoa:${byoa.mentionKey}] ✅ delivered`),
            )
            .catch((err) =>
              logger.warn(
                `[webhook:byoa:${byoa.mentionKey}] ⚠️ failed: ${err.message}`,
              ),
            );
        }
      } catch (byoaErr) {
        logger.error(
          "[webhook:byoa] Error dispatching BYOA webhooks:",
          byoaErr,
        );
      }
    }

    // ── Ice/Lava webhook dispatch ──────────────────────────────────────────────
    // Humans: @mention OR researchTag triggers both agents
    // AIs: only explicit @mention of the OTHER agent (no researchTag → prevents loops)
    const shouldTrigger = isHuman
      ? mentionsIce || mentionsLava || message.researchTag
      : mentionsIce || mentionsLava;

    if (!shouldTrigger) return; // Early return ONLY for ice/lava webhooks

    logger.info(
      `🤖 AI trigger: message ${message.id} from ${message.sender.username} (${senderType})`,
    );

    // Fetch last 10 messages for context (excluding the triggering message)
    const recentMessages = await prisma.message.findMany({
      where: { roomId: message.roomId, id: { not: message.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { sender: { select: { username: true, userType: true } } },
    });
    const context = recentMessages.reverse().map((m) => ({
      sender: m.sender.username,
      senderType: m.sender.userType,
      content: m.content,
      timestamp: m.createdAt,
    }));

    const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
    const baseUrl = process.env.CLIENT_URL ?? "http://localhost:4000";

    // Include attachment metadata if present
    const attachments = (message as any).attachments?.map((a: any) => ({
      id: a.id,
      filename: a.filename,
      url: `${baseUrl}${a.url}`,
      mimeType: a.mimeType,
      size: a.size,
      type: a.type,
    })) ?? [];

    const payload = JSON.stringify({
      messageId: message.id,
      sender: message.sender.username,
      senderType: message.sender.userType,
      content: message.content,
      room: message.roomId,
      timestamp: message.createdAt,
      attachments, // file metadata with full URLs
      context, // last 10 messages for conversational context
    });

    const webhooks: {
      agent: string;
      url: string | undefined;
      agentType: string;
    }[] = [
      { agent: "ice", url: process.env.ICE_WEBHOOK_URL, agentType: "AI_ICE" },
      {
        agent: "lava",
        url: process.env.LAVA_WEBHOOK_URL,
        agentType: "AI_LAVA",
      },
    ];

    for (const { agent, url, agentType } of webhooks) {
      if (!url) {
        logger.debug(`[webhook:${agent}] No URL configured — skipping`);
        continue;
      }
      // Never send back to the sender (prevent self-loops)
      if (senderType === agentType) continue;
      // For targeted @mentions: only notify the mentioned agent
      // For researchTag (humans only): notify all agents
      const isTargeted =
        (agent === "ice" && mentionsIce) || (agent === "lava" && mentionsLava);
      const isResearchBroadcast =
        isHuman && message.researchTag && !mentionsIce && !mentionsLava;
      if (!isTargeted && !isResearchBroadcast) continue;

      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Triologue-Secret": webhookSecret,
        },
        body: payload,
      })
        .then(() => logger.info(`[webhook:${agent}] ✅ delivered`))
        .catch((err) =>
          logger.warn(`[webhook:${agent}] ⚠️ failed: ${err.message}`),
        );
    }
  } catch (error) {
    logger.error("Error handling AI response:", error);
  }
}
