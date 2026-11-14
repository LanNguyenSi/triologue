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
import { hasUnstorableCharacter } from "../utils/validation";
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

    // Track online presence in Redis. Best-effort: the redis client (see
    // index.ts, agent-tasks 60efd603) sets disableOfflineQueue: true, so a
    // command issued while Redis is unreachable rejects immediately instead
    // of queuing forever. Presence is not something this connection's caller
    // waits on or needs to succeed, so a failure here is swallowed (and
    // logged) rather than left as an unhandled rejection or allowed to abort
    // the rest of the connection handler (room joins, last-seen update).
    if (socket.userId) {
      try {
        await redis.sAdd("online_users", socket.userId);
      } catch (error) {
        logger.warn(`Failed to mark ${socket.username} online in Redis:`, error);
      }
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

        // A NUL or a lone surrogate cannot be stored (Postgres refuses the
        // first, Prisma cannot serialise the second), so it is refused here,
        // before any query, with the reason on the error channel instead of
        // falling into the catch below and its generic "Failed to send message".
        if (typeof data.content === "string" && hasUnstorableCharacter(data.content)) {
          socket.emit("error", {
            message: "Message contains characters that cannot be stored",
          });
          return;
        }
        if (typeof data.roomId === "string" && hasUnstorableCharacter(data.roomId)) {
          socket.emit("error", {
            message: "Room id contains characters that cannot be stored",
          });
          return;
        }

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

        // A thread reply must name a thread of this room. Checked after the
        // membership gate, so a non-member cannot probe thread ids, and before
        // the mention quota is consumed and the message is written, so a
        // refused send costs nothing and the Message.threadId foreign key
        // never fails on insert. Absent or null is a top-level message.
        let requestedThreadId: string | null = null;
        if (data.threadId !== undefined && data.threadId !== null) {
          const candidate: unknown = data.threadId;
          const thread =
            typeof candidate === 'string' &&
            candidate.trim() !== '' &&
            !hasUnstorableCharacter(candidate)
              ? await prisma.thread.findUnique({
                  where: { id: candidate.trim() },
                  select: { id: true, roomId: true },
                })
              : null;
          if (!thread || thread.roomId !== data.roomId) {
            socket.emit('error', {
              message: 'threadId must name a thread in this room',
            });
            return;
          }
          requestedThreadId = thread.id;
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

        // Create message. A thread reply bumps the thread's counters in the
        // same transaction as the insert, so messageCount and lastActivity
        // cannot drift from the stored replies.
        const createMessage = (db: Prisma.TransactionClient) =>
          db.message.create({
            data: {
              content: data.content,
              senderId: socket.userId!,
              roomId: data.roomId,
              threadId: requestedThreadId ?? undefined,
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
        const threadIdForCounter = requestedThreadId;
        const message =
          threadIdForCounter === null
            ? await createMessage(prisma)
            : await prisma.$transaction(async (tx) => {
                const created = await createMessage(tx);
                await tx.thread.update({
                  where: { id: threadIdForCounter },
                  data: {
                    messageCount: { increment: 1 },
                    lastActivity: new Date(),
                  },
                });
                return created;
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

        // Store in Redis for caching. The message was already created and
        // broadcast above, so this is a best-effort cache warm, not part of
        // the send's success/failure. Caught locally (like
        // createMentionInboxItems above) rather than left to the outer
        // try/catch: the redis client (index.ts, agent-tasks 60efd603) sets
        // disableOfflineQueue: true, so a Redis outage now makes this reject
        // immediately instead of queuing — letting that fall through to the
        // outer catch would emit "Failed to send message" to a sender whose
        // message actually succeeded.
        await redis
          .setEx(`message:${message.id}`, 3600, JSON.stringify(message))
          .catch((error) => {
            logger.warn(`Failed to cache message ${message.id} in Redis:`, error);
          });

        // AI webhook dispatch disabled — Agent Gateway handles all routing.
      } catch (error) {
        logger.error("Error sending message:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Membership gate shared by the room-scoped handlers below: true only
    // when roomId is a plain room id (a non-empty string, and never a
    // `user:` personal room, refused even if a participant row for it
    // existed) and the user has a participant row for it. message:send
    // above keeps its own inline check instead: routing it through here
    // would change its answer to malformed roomIds (a non-string currently
    // reaches Prisma and gets the generic "Failed to send message", here it
    // would get "Not authorized").
    const isRoomParticipant = async (
      userId: string | undefined,
      roomId: unknown,
    ): Promise<boolean> => {
      if (
        !userId ||
        typeof roomId !== "string" ||
        roomId.length === 0 ||
        roomId.startsWith("user:")
      ) {
        return false;
      }
      const participation = await prisma.roomParticipant.findUnique({
        where: {
          userId_roomId: { userId, roomId },
        },
      });
      return participation !== null;
    };

    // Longest reaction emoji accepted, in UTF-16 code units. The client's
    // picker (emoji-picker-react, see
    // client/src/components/chat/ReactionSystem.tsx) only ever sends a
    // single emoji sequence, which stays well inside 16.
    const MAX_REACTION_EMOJI_LENGTH = 16;

    // Handle typing indicators. Typing is a best-effort UX signal: when the
    // sender is not a participant of the room (or the roomId is not a plain
    // non-empty room id, or it is a `user:` personal room) the event is
    // refused silently, with no DB write, no broadcast and no error event.
    // Without this gate TypingStatus.roomId (no foreign key in
    // schema.prisma) accepts any client-supplied room id, and the broadcast
    // reaches rooms the sender is not in, including a victim's `user:` room.
    socket.on("typing:start", async (data: { roomId: string }) => {
      try {
        if (!(await isRoomParticipant(socket.userId, data.roomId))) {
          return;
        }

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

    // Same best-effort gate as typing:start above: a non-participant, a
    // malformed roomId or a `user:` room id is refused with no write, no
    // broadcast and no error event.
    socket.on("typing:stop", async (data: { roomId: string }) => {
      try {
        if (!(await isRoomParticipant(socket.userId, data.roomId))) {
          return;
        }

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

    // Handle message reactions. The message row is loaded before anything is
    // written: an unknown messageId writes nothing, and the sender must be a
    // participant of the message's room (without that gate the upsert would
    // attach a reaction to any message by id and the broadcast below would
    // reach that room). Unlike the best-effort typing handlers, a refusal
    // here emits the same generic error shape the file already uses for
    // failed actions (message:send emits "error" to non-participants): one
    // indistinct message for every refused case, so the handler reveals
    // nothing about which check rejected. The emoji must be a non-empty
    // string of at most MAX_REACTION_EMOJI_LENGTH UTF-16 code units.
    socket.on("reaction:add", async (data: ReactionData) => {
      try {
        // Get message first, to gate the write on its room's membership.
        const message = await prisma.message.findUnique({
          where: { id: data.messageId },
          select: { roomId: true },
        });

        if (
          !message ||
          !(await isRoomParticipant(socket.userId, message.roomId))
        ) {
          socket.emit("error", { message: "Failed to add reaction" });
          return;
        }

        if (
          typeof data.emoji !== "string" ||
          data.emoji.length === 0 ||
          data.emoji.length > MAX_REACTION_EMOJI_LENGTH
        ) {
          socket.emit("error", { message: "Failed to add reaction" });
          return;
        }

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

        io.to(message.roomId).emit("reaction:added", {
          messageId: data.messageId,
          emoji: data.emoji,
          userId: socket.userId!,
          reaction,
        });
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
        // Best-effort, same as the sAdd on connect above: with
        // disableOfflineQueue: true (index.ts, agent-tasks 60efd603) a Redis
        // outage makes this reject immediately rather than queue. Caught
        // locally so a rejection neither becomes an unhandled rejection nor
        // aborts the last-seen update / typing-stop broadcast below it.
        if (remainingSockets.length === 0) {
          try {
            await redis.sRem("online_users", socket.userId);
          } catch (error) {
            logger.warn(`Failed to mark ${socket.username} offline in Redis:`, error);
          }
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
