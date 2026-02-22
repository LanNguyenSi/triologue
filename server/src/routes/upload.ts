import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";

const router = Router();

const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/gif": "IMAGE",
  "image/webp": "IMAGE",
  // SVG removed: can contain embedded JavaScript (XSS risk)
  "application/pdf": "DOCUMENT",
  "text/plain": "DOCUMENT",
  "text/markdown": "DOCUMENT",
  "text/csv": "DOCUMENT",
  "application/json": "DOCUMENT",
};

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = crypto.randomUUID() + ext;
    cb(null, safeName);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

router.post("/", authenticate, (req: Request, res: Response) => {
  upload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large (max 10 MB)" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const roomId = req.body.roomId;
    if (!roomId) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: "roomId is required" });
    }

    try {
      const participation = await prisma.roomParticipant.findUnique({
        where: {
          userId_roomId: { userId: req.user!.id, roomId },
        },
      });

      if (!participation) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: "Not a member of this room" });
      }

      const attachmentType = ALLOWED_MIME_TYPES[file.mimetype] || "DOCUMENT";
      const isImage = attachmentType === "IMAGE";
      const messageType = isImage ? "IMAGE" : "FILE";
      const fileUrl = `/uploads/${file.filename}`;

      const message = await prisma.message.create({
        data: {
          content: req.body.caption || "",
          senderId: req.user!.id,
          roomId,
          messageType: messageType as any,
          attachments: {
            create: {
              filename: file.originalname,
              url: fileUrl,
              mimeType: file.mimetype,
              size: file.size,
              type: attachmentType as any,
            },
          },
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
          attachments: true,
          reactions: true,
        },
      });

      await prisma.room.update({
        where: { id: roomId },
        data: {
          lastActivity: new Date(),
          messageCount: { increment: 1 },
        },
      });

      const io = req.app.get("io");
      if (io) {
        io.to(roomId).emit("message:new", message);
      }

      logger.info(
        `File uploaded: ${file.originalname} (${file.size} bytes) by ${req.user!.username}`,
      );

      res.json({
        message,
        attachment: message.attachments[0],
      });
    } catch (error) {
      logger.error("Upload failed:", error);
      fs.unlinkSync(file.path);
      res.status(500).json({ error: "Upload failed" });
    }
  });
});

export { router as uploadRoutes };
