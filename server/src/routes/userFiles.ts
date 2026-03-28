import { Router } from "express";
import multer from "multer";
import path from "path";
import { authenticate } from "../middleware/auth";
import { listEnabledConnectors } from "../connectors/registry";
import prisma from "../lib/prisma";
import { getTokenForUser } from "../services/tokenManager";
import { logger } from "../utils/logger";

const router = Router();

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

interface SharePointBrowserItem {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  lastModified: string;
  webUrl: string;
  isFolder: boolean;
  downloadUrl: string;
  childCount: number | null;
}

interface SharePointSourcePayload {
  id: string;
  provider: string;
  label: string;
  siteUrl: string;
  siteId: string;
  siteName: string;
  driveId: string;
  driveName: string;
  webUrl: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeSharePointPath(value: unknown, fallback = "/"): string {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return fallback;
  if (input === "/") return "/";
  const prefixed = input.startsWith("/") ? input : `/${input}`;
  return prefixed.replace(/\/{2,}/g, "/");
}

function encodeSharePointPath(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function joinSharePointPath(folderPath: string, name: string): string {
  const normalizedFolder = normalizeSharePointPath(folderPath);
  if (normalizedFolder === "/") return `/${name}`;
  return path.posix.join(normalizedFolder, name);
}

async function getUserGraphToken(userId: string): Promise<string> {
  const token = await getTokenForUser("microsoft", "graph", userId);
  if (!token) {
    throw new Error(
      "Keine persoenliche SharePoint-Verbindung gefunden. Bitte verbinde zuerst SharePoint.",
    );
  }
  return token;
}

async function graphRequest(
  userId: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getUserGraphToken(userId);
  const url = input.startsWith("http") ? input : `${GRAPH_BASE}${input}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

async function graphJson<T>(
  userId: string,
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await graphRequest(userId, input, init);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SharePoint request failed (${response.status}): ${errorText.slice(0, 400)}`,
    );
  }
  return (await response.json()) as T;
}

async function resolveSharePointSiteForUser(userId: string, rawSiteUrl: string) {
  const siteUrl = new URL(rawSiteUrl);
  if (siteUrl.protocol !== "https:") {
    throw new Error("SharePoint siteUrl muss mit https:// beginnen.");
  }

  const sitePath = siteUrl.pathname || "/";
  const site = await graphJson<any>(
    userId,
    `/sites/${siteUrl.hostname}:${sitePath}`,
  );
  const drive = await graphJson<any>(userId, `/sites/${site.id}/drive`);

  return {
    siteId: String(site.id),
    siteName: String(site.displayName || site.name || rawSiteUrl),
    siteUrl: rawSiteUrl,
    driveId: String(drive.id),
    driveName: String(drive.name || "Documents"),
    webUrl: String(site.webUrl || rawSiteUrl),
  };
}

function isSharePointEnabled(): boolean {
  return listEnabledConnectors().some((connector) => connector.id === "sharepoint");
}

function mapSharePointSource(source: any): SharePointSourcePayload {
  return {
    id: String(source.id || ""),
    provider: String(source.provider || "sharepoint"),
    label: String(source.label || source.siteName || source.driveName || "SharePoint"),
    siteUrl: String(source.siteUrl || ""),
    siteId: String(source.siteId || ""),
    siteName: String(source.siteName || ""),
    driveId: String(source.driveId || ""),
    driveName: String(source.driveName || ""),
    webUrl: String(source.webUrl || ""),
    createdAt:
      source.createdAt instanceof Date
        ? source.createdAt.toISOString()
        : String(source.createdAt || ""),
    updatedAt:
      source.updatedAt instanceof Date
        ? source.updatedAt.toISOString()
        : String(source.updatedAt || ""),
  };
}

async function getSharePointSourceForUser(
  userId: string,
  sourceId: string,
): Promise<any> {
  const source = await (prisma as any).userFileSource.findFirst({
    where: {
      id: sourceId,
      userId,
      provider: "sharepoint",
    },
  });

  if (!source) {
    throw new Error("Dateiquelle nicht gefunden.");
  }
  if (!source.driveId) {
    throw new Error("Dateiquelle ist unvollstaendig konfiguriert.");
  }

  return source;
}

function mapSharePointItem(
  item: any,
  folderPath: string,
): SharePointBrowserItem {
  const itemPath = joinSharePointPath(folderPath, String(item.name || ""));
  const isFolder = Boolean(item.folder);
  return {
    id: String(item.id || ""),
    name: String(item.name || ""),
    path: itemPath,
    size: Number(item.size || 0),
    mimeType: isFolder
      ? "inode/directory"
      : String(item.file?.mimeType || "application/octet-stream"),
    lastModified: String(item.lastModifiedDateTime || ""),
    webUrl: String(item.webUrl || ""),
    isFolder,
    downloadUrl: String(item["@microsoft.graph.downloadUrl"] || ""),
    childCount:
      typeof item.folder?.childCount === "number" ? item.folder.childCount : null,
  };
}

router.get("/providers", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const connectors = listEnabledConnectors().filter(
      (connector) => connector.category === "storage",
    );

    const items = await Promise.all(
      connectors.map(async (connector) => {
        const personalConnection = await getTokenForUser(
          connector.auth.provider,
          connector.auth.scope,
          userId,
        );

        return {
          id: connector.id,
          name: connector.name,
          provider: connector.provider,
          category: connector.category,
          connected: Boolean(personalConnection),
          connectionPath: "/settings/connections",
        };
      }),
    );

    return res.json({ items });
  } catch (error) {
    logger.error("[user-files] Failed to load providers:", error);
    return res.status(500).json({ error: "Failed to load file providers" });
  }
});

router.get("/sources", authenticate, async (req, res) => {
  try {
    const provider = String(req.query.provider || "").trim().toLowerCase();
    const items = await (prisma as any).userFileSource.findMany({
      where: {
        userId: req.user!.id,
        ...(provider ? { provider } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    return res.json({ items: items.map(mapSharePointSource) });
  } catch (error: any) {
    logger.error("[user-files] Failed to list file sources:", error);
    return res.status(500).json({
      error: error?.message || "Dateiquellen konnten nicht geladen werden",
    });
  }
});

router.post("/sources/sharepoint", authenticate, async (req, res) => {
  try {
    if (!isSharePointEnabled()) {
      return res.status(404).json({ error: "SharePoint ist nicht aktiviert." });
    }

    const siteUrl = String(req.body?.siteUrl || "").trim();
    const label = String(req.body?.label || "").trim();

    if (!siteUrl) {
      return res.status(400).json({ error: "siteUrl is required" });
    }

    const site = await resolveSharePointSiteForUser(req.user!.id, siteUrl);
    const existing = await (prisma as any).userFileSource.findFirst({
      where: {
        userId: req.user!.id,
        provider: "sharepoint",
        driveId: site.driveId,
      },
    });

    const data = {
      userId: req.user!.id,
      provider: "sharepoint",
      label: label || site.siteName || site.driveName || "SharePoint",
      siteUrl: site.siteUrl,
      siteId: site.siteId,
      siteName: site.siteName,
      driveId: site.driveId,
      driveName: site.driveName,
      webUrl: site.webUrl,
      metadata: {},
    };

    const record = existing
      ? await (prisma as any).userFileSource.update({
          where: { id: existing.id },
          data,
        })
      : await (prisma as any).userFileSource.create({ data });

    return res.status(existing ? 200 : 201).json({
      source: mapSharePointSource(record),
    });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "SharePoint Quelle konnte nicht gespeichert werden",
    });
  }
});

router.delete("/sources/:sourceId", authenticate, async (req, res) => {
  try {
    const source = await (prisma as any).userFileSource.findFirst({
      where: {
        id: req.params.sourceId,
        userId: req.user!.id,
      },
      select: { id: true },
    });

    if (!source) {
      return res.status(404).json({ error: "Dateiquelle nicht gefunden." });
    }

    await (prisma as any).userFileSource.delete({
      where: { id: source.id },
    });

    return res.json({ success: true, sourceId: source.id });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "Dateiquelle konnte nicht geloescht werden",
    });
  }
});

router.post("/sharepoint/resolve-site", authenticate, async (req, res) => {
  try {
    const siteUrl = String(req.body?.siteUrl || "").trim();
    if (!siteUrl) {
      return res.status(400).json({ error: "siteUrl is required" });
    }

    const site = await resolveSharePointSiteForUser(req.user!.id, siteUrl);
    return res.json({ site });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "SharePoint site konnte nicht aufgeloest werden",
    });
  }
});

router.get("/sharepoint/files", authenticate, async (req, res) => {
  try {
    const sourceId = String(req.query.sourceId || "").trim();
    const folderPath = normalizeSharePointPath(req.query.folderPath, "/");

    if (!sourceId) {
      return res.status(400).json({ error: "sourceId is required" });
    }

    const source = await getSharePointSourceForUser(req.user!.id, sourceId);
    const driveId = String(source.driveId);

    const encodedPath = encodeSharePointPath(folderPath);
    const endpoint =
      folderPath === "/"
        ? `/drives/${encodeURIComponent(driveId)}/root/children`
        : `/drives/${encodeURIComponent(driveId)}/root:${encodedPath}:/children`;

    const data = await graphJson<{ value?: any[] }>(req.user!.id, endpoint);
    const items = (data.value || [])
      .map((item) => mapSharePointItem(item, folderPath))
      .sort((left, right) => {
        if (left.isFolder !== right.isFolder) {
          return left.isFolder ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "de", {
          sensitivity: "base",
        });
      });

    return res.json({
      source: mapSharePointSource(source),
      folderPath,
      items,
    });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "SharePoint folder konnte nicht geladen werden",
    });
  }
});

router.get("/sharepoint/download", authenticate, async (req, res) => {
  try {
    const sourceId = String(req.query.sourceId || "").trim();
    const filePath = normalizeSharePointPath(req.query.filePath, "");

    if (!sourceId || !filePath) {
      return res.status(400).json({ error: "sourceId and filePath are required" });
    }

    const source = await getSharePointSourceForUser(req.user!.id, sourceId);
    const driveId = String(source.driveId);

    const encodedPath = encodeSharePointPath(filePath);
    const response = await graphRequest(
      req.user!.id,
      `/drives/${encodeURIComponent(driveId)}/root:${encodedPath}:/content`,
      { redirect: "follow" },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(400).json({
        error: `SharePoint download failed (${response.status}): ${errorText.slice(0, 400)}`,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = path.posix.basename(filePath);
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/"/g, "")}"`,
    );
    return res.send(buffer);
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || "SharePoint Datei konnte nicht geladen werden",
    });
  }
});

router.post(
  "/sharepoint/upload",
  authenticate,
  (req, res) => {
    upload.single("file")(req, res, async (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 20 MB)" });
        }
        return res.status(400).json({ error: error.message });
      }
      if (error) {
        return res.status(400).json({ error: error.message });
      }

      try {
        const sourceId = String(req.body?.sourceId || "").trim();
        const folderPath = normalizeSharePointPath(req.body?.folderPath, "/");
        const file = req.file;

        if (!sourceId) {
          return res.status(400).json({ error: "sourceId is required" });
        }
        if (!file) {
          return res.status(400).json({ error: "file is required" });
        }

        const source = await getSharePointSourceForUser(req.user!.id, sourceId);
        const driveId = String(source.driveId);

        const targetPath = joinSharePointPath(folderPath, file.originalname);
        const encodedPath = encodeSharePointPath(targetPath);
        const response = await graphRequest(
          req.user!.id,
          `/drives/${encodeURIComponent(driveId)}/root:${encodedPath}:/content`,
          {
            method: "PUT",
            headers: {
              "Content-Type":
                file.mimetype || "application/octet-stream",
            },
            body: file.buffer,
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          return res.status(400).json({
            error: `SharePoint upload failed (${response.status}): ${errorText.slice(0, 400)}`,
          });
        }

        const item = await response.json();
        return res.status(201).json({
          source: mapSharePointSource(source),
          item: mapSharePointItem(item, folderPath),
        });
      } catch (uploadError: any) {
        return res.status(400).json({
          error: uploadError?.message || "SharePoint upload fehlgeschlagen",
        });
      }
    });
  },
);

export { router as userFilesRoutes };
