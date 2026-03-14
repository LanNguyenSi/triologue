import { getToken } from "../../services/tokenManager";

export interface SharePointFileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: string;
  downloadUrl: string;
  webUrl: string;
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getGraphToken(): Promise<string> {
  const token = await getToken("microsoft", "graph");
  if (!token)
    throw new Error(
      "Microsoft Graph token not available. Connect SharePoint first.",
    );
  return token;
}

export async function listFiles(
  driveId: string,
  folderPath: string = "/",
): Promise<SharePointFileInfo[]> {
  const token = await getGraphToken();
  const encodedPath = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  const url =
    folderPath === "/"
      ? `${GRAPH_BASE}/drives/${driveId}/root/children`
      : `${GRAPH_BASE}/drives/${driveId}/root:${encodedPath}:/children`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SharePoint list failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { value?: any[] };
  return (data.value || []).map((item: any) => ({
    id: item.id,
    name: item.name,
    size: item.size || 0,
    mimeType: item.file?.mimeType || "application/octet-stream",
    lastModified: item.lastModifiedDateTime || "",
    downloadUrl: item["@microsoft.graph.downloadUrl"] || "",
    webUrl: item.webUrl || "",
  }));
}

export async function downloadFile(
  driveId: string,
  filePath: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const token = await getGraphToken();
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");
  const url = `${GRAPH_BASE}/drives/${driveId}/root:${encodedPath}:/content`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`SharePoint download failed (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType =
    res.headers.get("content-type") || "application/octet-stream";
  const filename = filePath.split("/").pop() || "download";

  return { buffer, mimeType: contentType, filename };
}

export async function uploadFile(
  driveId: string,
  filePath: string,
  content: Buffer | string,
  mimeType: string = "application/octet-stream",
): Promise<SharePointFileInfo> {
  const token = await getGraphToken();
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");
  const url = `${GRAPH_BASE}/drives/${driveId}/root:${encodedPath}:/content`;

  const body =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SharePoint upload failed (${res.status}): ${err}`);
  }

  const item = (await res.json()) as any;
  return {
    id: item.id,
    name: item.name,
    size: item.size || 0,
    mimeType: item.file?.mimeType || mimeType,
    lastModified: item.lastModifiedDateTime || "",
    downloadUrl: item["@microsoft.graph.downloadUrl"] || "",
    webUrl: item.webUrl || "",
  };
}

export async function getDriveInfo(
  siteUrl: string,
): Promise<{ driveId: string; siteName: string }> {
  const token = await getGraphToken();
  const hostname = new URL(siteUrl).hostname;
  const sitePath = new URL(siteUrl).pathname;

  const siteRes = await fetch(`${GRAPH_BASE}/sites/${hostname}:${sitePath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!siteRes.ok) throw new Error(`SharePoint site not found: ${siteUrl}`);
  const site = (await siteRes.json()) as any;

  const driveRes = await fetch(`${GRAPH_BASE}/sites/${site.id}/drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!driveRes.ok) throw new Error("Failed to get default drive for site");
  const drive = (await driveRes.json()) as any;

  return { driveId: drive.id, siteName: site.displayName || site.name };
}
