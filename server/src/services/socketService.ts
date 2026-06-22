import { Server as SocketIOServer, Socket } from "socket.io";
import { PrismaClient, MessageType, Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { consumeMention } from "./mentionLimiter";
import { createMentionInboxItems } from "./inboxService";
import {
  getLinkedProjectStatus,
  isRoomWriteBlocked,
} from "../utils/projectRoomPolicy";
import { pluginManager } from "../plugins/manager";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  userType?: string;
}

interface RedisLike {
  sAdd(key: string, value: string): Promise<unknown>;
  sRem(key: string, value: string): Promise<unknown>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
}

interface MessageData {
  content: string;
  roomId: string;
  threadId?: string;
  messageType?: MessageType;
  researchTag?: string;
  aiContext?: Prisma.InputJsonValue;
}

interface ReactionData {
  messageId: string;
  emoji: string;
}

export function socketHandler(
  io: SocketIOServer,
  prisma: PrismaClient,
  redis: RedisLike,
) {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

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

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

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

        const linkedProjectStatus = await getLinkedProjectStatus(
          prisma,
          data.roomId,
        );
        if (isRoomWriteBlocked(linkedProjectStatus)) {
          socket.emit("error", {
            code: "PROJECT_CLOSED",
            roomId: data.roomId,
            message:
              "Messages are disabled because the linked project is closed.",
          });
          return;
        }

        // Check for AGENT @mentions and rate limit (only for human senders)
        if (socket.userType === 'HUMAN') {
          // Load all active agents in this room
          const activeAgents = await prisma.agentToken.findMany({
            where: {
              isActive: true,
              status: 'active',
              agentUser: {
                participations: { some: { roomId: data.roomId } },
              },
            },
            select: { mentionKey: true, createdById: true, quotaExempt: true },
          });

          // Lowercase once for case-insensitive mention matching below
          const contentLower = data.content.toLowerCase();

          // Only count against quota for agents that are:
          // 1. NOT owned by the sender (own agents = own cost)
          // 2. NOT quota-exempt (e.g. local LLM agents)
          const hasBillableMention = activeAgents.some((agent) =>
            contentLower.includes(`@${agent.mentionKey.toLowerCase()}`)
            && agent.createdById !== socket.userId
            && !agent.quotaExempt
          );

          if (hasBillableMention) {
            const limitCheck = await consumeMention(socket.userId!);

            if (!limitCheck.allowed) {
              // Limit exceeded — notify sender via dedicated event (localized on client)
              socket.emit('mention:warning', {
                type: 'limit_reached',
                current: limitCheck.current,
                limit: limitCheck.limit,
                remaining: 0,
                message: `⚠️ Daily mention limit reached (${limitCheck.current}/${limitCheck.limit}). Resets at midnight UTC.`,
              });
              return; // Don't process the mention
            }

            if (limitCheck.needsWarning) {
              // Warning threshold reached — emit as dedicated event (toast),
              // not as a chat message, to avoid race conditions with the
              // user's own message being rendered simultaneously.
              const remaining = limitCheck.limit - limitCheck.current;
              socket.emit('mention:warning', {
                type: 'threshold',
                current: limitCheck.current,
                limit: limitCheck.limit,
                remaining,
                message: `ℹ️ ${remaining} mentions remaining today (${limitCheck.current}/${limitCheck.limit}).`,
              });
            }
          }
        }

        // Create message
        const message = await prisma.message.create({
          data: {
            content: data.content,
            senderId: socket.userId!,
            roomId: data.roomId,
            threadId: data.threadId,
            messageType: data.messageType || MessageType.TEXT,
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

        await pluginManager.emit("message.created", {
          messageId: message.id,
          roomId: data.roomId,
          senderId: socket.userId!,
          source: "socket",
          messageType: message.messageType,
        });

        await createMentionInboxItems({
          roomId: data.roomId,
          actorId: socket.userId!,
          content: data.content || "",
          messageId: message.id,
          io,
        }).catch((error) => {
          logger.warn(`Failed to create mention inbox items: ${error}`);
        });

        // Store in Redis for caching
        await redis.setEx(
          `message:${message.id}`,
          3600,
          JSON.stringify(message),
        );

        // AI webhook dispatch disabled — Agent Gateway handles all routing.
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
            emoji: data.emoji,
            userId: socket.userId!,
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
          (s) => (s as AuthenticatedSocket).userId === socket.userId && s.id !== socket.id,
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
