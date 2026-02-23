import { Server as SocketIOServer, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { checkMentionLimit } from "./mentionLimiter";

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

        // Check for @mentions and rate limit
        const mentionRegex = /@\w+/g;
        const mentions = data.content.match(mentionRegex);

        if (mentions && mentions.length > 0) {
          const limitCheck = await checkMentionLimit(socket.userId!);

          if (!limitCheck.allowed) {
            // Limit exceeded - send system message
            const systemMessage = await prisma.message.create({
              data: {
                content: `⚠️ Daily mention limit reached (${limitCheck.current}/${limitCheck.limit}). Resets at midnight UTC.`,
                senderId: 'gateway-system',
                roomId: data.roomId,
                messageType: 'SYSTEM',
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
                reactions: true,
                attachments: true,
              },
            });

            io.to(data.roomId).emit("message:new", systemMessage);
            return; // Don't process the mention
          }

          if (limitCheck.needsWarning) {
            // Warning threshold reached
            const remaining = limitCheck.limit - limitCheck.current;
            const warningMessage = await prisma.message.create({
              data: {
                content: `ℹ️ ${remaining} mentions remaining today (${limitCheck.current}/${limitCheck.limit}).`,
                senderId: 'gateway-system',
                roomId: data.roomId,
                messageType: 'SYSTEM',
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
                reactions: true,
                attachments: true,
              },
            });

            io.to(data.roomId).emit("message:new", warningMessage);
          }
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

        // AI webhook dispatch disabled — Agent Gateway handles all routing.
        // handleAIResponse(message, prisma, io, redis);
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

// ── Agent Loop Guard ───────────────────────────────────────────────────────
// Tracks consecutive AI messages per room (without human intervention).
// When threshold is exceeded, webhook dispatch is paused and a warning
// is emitted to the room. Resets when a human sends a message.
const AGENT_LOOP_THRESHOLD = 3; // max consecutive AI messages before pause
const AGENT_LOOP_COOLDOWN_SEC = 300; // auto-reset after 5 min of silence
const LOOP_GUARD_PREFIX = "agent_loop:";

async function incrementAgentLoopCounter(
  roomId: string,
  redis: any,
): Promise<number> {
  const key = `${LOOP_GUARD_PREFIX}${roomId}`;
  const count = await redis.incr(key);
  await redis.expire(key, AGENT_LOOP_COOLDOWN_SEC);
  return count;
}

async function resetAgentLoopCounter(
  roomId: string,
  redis: any,
): Promise<void> {
  await redis.del(`${LOOP_GUARD_PREFIX}${roomId}`);
}

async function getAgentLoopCount(
  roomId: string,
  redis: any,
): Promise<number> {
  const val = await redis.get(`${LOOP_GUARD_PREFIX}${roomId}`);
  return val ? parseInt(val, 10) : 0;
}

// ── UNIFIED AI Webhook Dispatch ────────────────────────────────────────────
// All agents (Ice, Lava, BYOA) use the same dispatch system.
// Agents are identified by their AgentToken in the database.
// trustLevel: "elevated" = can be triggered by other AIs (Ice↔Lava dialog)
//             "standard" = only triggered by humans (anti-loop default)
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

    // ── Loop Guard: reset counter on human message, check on AI message ──
    if (isHuman) {
      await resetAgentLoopCounter(message.roomId, redis);
    } else {
      const count = await incrementAgentLoopCounter(message.roomId, redis);
      if (count > AGENT_LOOP_THRESHOLD) {
        if (count === AGENT_LOOP_THRESHOLD + 1) {
          // Emit warning once (on first exceeded message)
          logger.warn(
            `[loop-guard] 🛑 Agent loop detected in room ${message.roomId} — ${count} consecutive AI messages, pausing dispatch`,
          );
          // Create a system message visible to all room participants
          const systemMessage = await prisma.message.create({
            data: {
              content: `⚠️ **Loop Guard:** ${count} aufeinanderfolgende Agent-Nachrichten ohne menschliche Beteiligung erkannt. Agent-Webhooks sind pausiert bis ein Mensch schreibt.`,
              senderId: message.senderId, // attribute to last agent (no system user)
              roomId: message.roomId,
              messageType: "SYSTEM",
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
              reactions: { include: { user: { select: { username: true, displayName: true } } } },
              attachments: true,
            },
          });
          io.to(message.roomId).emit("message:new", systemMessage);
        }
        return; // Do NOT dispatch webhooks
      }
    }

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
        await redis.expire(rateLimitKey, 5 * 60);
      }
      if (currentCount > 5) {
        logger.warn(
          `[webhook] Rate limit hit for user ${message.sender.username} — skipping`,
        );
        return;
      }
    }

    // ── Load ALL active agents in this room from DB ──
    const agents = await (prisma as any).agentToken.findMany({
      where: {
        isActive: true,
        status: "active",
        agentUser: {
          participations: { some: { roomId: message.roomId } },
        },
      },
      include: { agentUser: { select: { id: true, username: true } } },
    });

    if (agents.length === 0) return;

    // ── Determine which agents to notify ──
    const agentsToNotify: any[] = [];

    for (const agent of agents) {
      // Never send back to the sender (prevent self-loops)
      if (agent.userId === message.senderId) continue;

      const mentioned = content.includes(`@${agent.mentionKey}`);

      if (isHuman) {
        // Humans can trigger agents via @mention or researchTag (broadcast)
        const isResearchBroadcast =
          message.researchTag && !agents.some((a: any) => content.includes(`@${a.mentionKey}`));
        if (mentioned || isResearchBroadcast) {
          agentsToNotify.push(agent);
        }
      } else {
        // AI-to-AI: only explicit @mention AND only if target has elevated trust
        if (mentioned && agent.trustLevel === "elevated") {
          agentsToNotify.push(agent);
        }
      }
    }

    if (agentsToNotify.length === 0) return;

    // ── Build shared context (fetched once for all agents) ──
    const recentMessages = await prisma.message.findMany({
      where: { roomId: message.roomId, id: { not: message.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { sender: { select: { username: true, userType: true } } },
    });
    const context = recentMessages.reverse().map((m: any) => ({
      sender: m.sender.username,
      senderType: m.sender.userType,
      content: m.content,
      timestamp: m.createdAt,
    }));

    const globalWebhookSecret = process.env.WEBHOOK_SECRET ?? "";
    const baseUrl = process.env.CLIENT_URL ?? "http://localhost:4000";

    const attachments =
      (message as any).attachments?.map((a: any) => ({
        id: a.id,
        filename: a.filename,
        url: `${baseUrl}${a.url}`,
        mimeType: a.mimeType,
        size: a.size,
        type: a.type,
      })) ?? [];

    // ── Dispatch to each agent ──
    for (const agent of agentsToNotify) {
      const payload = JSON.stringify({
        messageId: message.id,
        sender: message.sender.username,
        senderType: message.sender.userType,
        content: message.content,
        room: message.roomId,
        timestamp: message.createdAt,
        attachments,
        context,
      });

      logger.info(
        `🤖 Dispatching to @${agent.mentionKey}: message from ${message.sender.username}`,
      );

      fetch(agent.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Triologue-Secret": agent.webhookSecret ?? globalWebhookSecret,
          "X-Triologue-Agent": agent.mentionKey,
        },
        body: payload,
      })
        .then(() =>
          logger.info(`[webhook:${agent.mentionKey}] ✅ delivered`),
        )
        .catch((err) =>
          logger.warn(
            `[webhook:${agent.mentionKey}] ⚠️ failed: ${err.message}`,
          ),
        );
    }
  } catch (error) {
    logger.error("Error handling AI response:", error);
  }
}
