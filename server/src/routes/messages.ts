import { Router } from "express";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";

const router = Router();

const PAGE_SIZE = 50;
const SEARCH_PAGE_SIZE = 20;

/**
 * GET /api/messages/:roomId
 * Cursor-based pagination for messages.
 *
 * Query params:
 *   limit  — messages per page (default 50, max 100)
 *   before — message id cursor: fetch messages OLDER than this id
 *   after  — message id cursor: fetch messages NEWER than this id (for "load new")
 *
 * Response:
 *   { messages: [...], hasMore: bool, nextCursor: string|null, total: number }
 */
router.get("/:roomId", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Verify room membership
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: req.user!.id, roomId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    const limit = Math.min(Number(req.query.limit ?? PAGE_SIZE), 100);
    const before = req.query.before as string | undefined; // older messages
    const after = req.query.after as string | undefined; // newer messages (unused by frontend atm)

    // Build cursor filter
    let cursorFilter: any = {};
    if (before) {
      // Find the cursor message's createdAt to use as a time-based cursor
      const cursorMsg = await prisma.message.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursorMsg) {
        cursorFilter = { createdAt: { lt: cursorMsg.createdAt } };
      }
    } else if (after) {
      const cursorMsg = await prisma.message.findUnique({
        where: { id: after },
        select: { createdAt: true },
      });
      if (cursorMsg) {
        cursorFilter = { createdAt: { gt: cursorMsg.createdAt } };
      }
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        ...cursorFilter,
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
        pinnedBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        reactions: {
          include: {
            user: { select: { username: true, displayName: true } },
          },
        },
        attachments: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to determine hasMore
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop(); // remove the extra item

    // Return in chronological order (oldest first)
    const sorted = messages.reverse();
    const nextCursor = hasMore ? (sorted[0]?.id ?? null) : null;

    res.json({
      messages: sorted,
      hasMore,
      nextCursor, // pass this as `before` to load older messages
      count: sorted.length,
    });
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * GET /api/messages/:roomId/search
 * Search messages in a room.
 *
 * Query params:
 *   q     — search term (min 2 chars)
 *   limit — max results (default 20, max 50)
 */
router.get("/:roomId/search", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const rawQuery = String(req.query.q ?? "").trim();
    const query = rawQuery.slice(0, 200);
    if (query.length < 2) {
      return res.json({ items: [], count: 0 });
    }

    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: req.user!.id, roomId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    const rawLimit = Number.parseInt(String(req.query.limit ?? SEARCH_PAGE_SIZE), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, 50))
      : SEARCH_PAGE_SIZE;

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        content: {
          contains: query,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({ items: messages, count: messages.length });
  } catch (error) {
    console.error("Failed to search messages:", error);
    res.status(500).json({ error: "Failed to search messages" });
  }
});

/**
 * DELETE /api/messages/:messageId
 * Soft-delete a message (set isDeleted=true).
 *
 * Permissions:
 *   - Message sender can delete their own messages
 *   - Room admins can delete any message in their room
 *   - Triologue admins (isAdmin=true) can delete any message
 */
router.delete("/:messageId", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.id; // from authenticate middleware

    // Get the message
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.isDeleted) {
      return res.status(410).json({ error: "Message already deleted" });
    }

    // Get user for admin check
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    // Permission check: only message sender or global admin can delete
    const isOwner = message.senderId === userId;
    const isAdmin = user?.isAdmin ?? false;

    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this message" });
    }

    // Soft delete
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    // Broadcast deletion to room via Socket.io
    const io = req.app.get("io");
    if (io && message.roomId) {
      io.to(message.roomId).emit("message:deleted", {
        messageId,
        roomId: message.roomId,
      });
    }

    res.json({ success: true, messageId });
  } catch (error) {
    console.error("Failed to delete message:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

/**
 * GET /api/messages/:roomId/pinned
 * Fetch all pinned messages for a room.
 */
router.get("/:roomId/pinned", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;

    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: req.user!.id, roomId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        isPinned: true,
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
        pinnedBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        reactions: {
          include: {
            user: { select: { username: true, displayName: true } },
          },
        },
        attachments: true,
      },
      orderBy: { pinnedAt: "desc" },
    });

    res.json({ messages, count: messages.length });
  } catch (error) {
    console.error("Failed to fetch pinned messages:", error);
    res.status(500).json({ error: "Failed to fetch pinned messages" });
  }
});

/**
 * PATCH /api/messages/:messageId/pin
 * Pin a message.
 *
 * Permissions:
 *   - Room OWNER or ADMIN can pin
 *   - Global admins (isAdmin=true) can pin
 */
router.patch("/:messageId/pin", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.isDeleted) {
      return res.status(410).json({ error: "Cannot pin a deleted message" });
    }

    if (message.isPinned) {
      return res.status(409).json({ error: "Message is already pinned" });
    }

    // Permission check: room OWNER/ADMIN or global admin
    const [membership, user] = await Promise.all([
      prisma.roomParticipant.findUnique({
        where: { userId_roomId: { userId, roomId: message.roomId } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true, displayName: true, username: true },
      }),
    ]);

    const isGlobalAdmin = user?.isAdmin ?? false;
    const isRoomPrivileged = membership && ["OWNER", "ADMIN"].includes(membership.role);

    if (!isRoomPrivileged && !isGlobalAdmin) {
      return res.status(403).json({ error: "Not authorized to pin messages" });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        isPinned: true,
        pinnedAt: new Date(),
        pinnedById: userId,
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
        pinnedBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    // Broadcast to room via Socket.io
    const io = req.app.get("io");
    if (io) {
      io.to(message.roomId).emit("message:pinned", {
        messageId,
        roomId: message.roomId,
        isPinned: true,
        pinnedAt: updated.pinnedAt,
        pinnedBy: updated.pinnedBy,
      });
    }

    res.json({ success: true, messageId, pinnedBy: updated.pinnedBy });
  } catch (error) {
    console.error("Failed to pin message:", error);
    res.status(500).json({ error: "Failed to pin message" });
  }
});

/**
 * PATCH /api/messages/:messageId/unpin
 * Unpin a message.
 *
 * Permissions:
 *   - Room OWNER or ADMIN can unpin
 *   - Global admins (isAdmin=true) can unpin
 */
router.patch("/:messageId/unpin", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (!message.isPinned) {
      return res.status(409).json({ error: "Message is not pinned" });
    }

    // Permission check: room OWNER/ADMIN or global admin
    const [membership, user] = await Promise.all([
      prisma.roomParticipant.findUnique({
        where: { userId_roomId: { userId, roomId: message.roomId } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      }),
    ]);

    const isGlobalAdmin = user?.isAdmin ?? false;
    const isRoomPrivileged = membership && ["OWNER", "ADMIN"].includes(membership.role);

    if (!isRoomPrivileged && !isGlobalAdmin) {
      return res.status(403).json({ error: "Not authorized to unpin messages" });
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        isPinned: false,
        pinnedAt: null,
        pinnedById: null,
      },
    });

    // Broadcast to room via Socket.io
    const io = req.app.get("io");
    if (io) {
      io.to(message.roomId).emit("message:unpinned", {
        messageId,
        roomId: message.roomId,
        isPinned: false,
      });
    }

    res.json({ success: true, messageId });
  } catch (error) {
    console.error("Failed to unpin message:", error);
    res.status(500).json({ error: "Failed to unpin message" });
  }
});

export { router as messageRoutes };
