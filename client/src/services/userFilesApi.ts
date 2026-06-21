import { apiClient } from '../lib/apiClient';
import { readError } from '../lib/apiError';

export interface FileProviderInfo {
  id: string;
  name: string;
  provider: string;
  category: string;
  connected: boolean;
  connectionPath: string;
}

export interface UserFileSource {
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

export interface SharePointBrowserItem {
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

export async function fetchFileProviders(): Promise<FileProviderInfo[]> {
  const response = await apiClient(`/api/user-files/providers`);
  if (!response.ok) {
    throw await readError(response, "Datei-Provider konnten nicht geladen werden.");
  }
  const data = await response.json();
  return data.items || [];
}

export async function fetchUserFileSources(
  provider?: string,
): Promise<UserFileSource[]> {
  const query = provider
    ? `?${new URLSearchParams({ provider }).toString()}`
    : "";
  const response = await apiClient(`/api/user-files/sources${query}`);
  if (!response.ok) {
    throw await readError(response, "Dateiquellen konnten nicht geladen werden.");
  }
  const data = await response.json();
  return data.items || [];
}

export async function createSharePointSource(
  params: { siteUrl: string; label?: string },
): Promise<UserFileSource> {
  const response = await apiClient(`/api/user-files/sources/sharepoint`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw await readError(response, "SharePoint Quelle konnte nicht gespeichert werden.");
  }
  const data = await response.json();
  return data.source;
}

export async function deleteUserFileSource(
  sourceId: string,
): Promise<void> {
  const response = await apiClient(`/api/user-files/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw await readError(response, "Dateiquelle konnte nicht geloescht werden.");
  }
}

export async function listSharePointFiles(
  sourceId: string,
  folderPath: string,
): Promise<{
  source: UserFileSource;
  folderPath: string;
  items: SharePointBrowserItem[];
}> {
  const query = new URLSearchParams({
    sourceId,
    folderPath,
  });
  const response = await apiClient(
    `/api/user-files/sharepoint/files?${query.toString()}`,
  );
  if (!response.ok) {
    throw await readError(response, "SharePoint Dateien konnten nicht geladen werden.");
  }
  return response.json();
}

export async function uploadSharePointFile(
  params: {
    sourceId: string;
    folderPath: string;
    file: File;
  },
): Promise<SharePointBrowserItem> {
  const formData = new FormData();
  formData.append("sourceId", params.sourceId);
  formData.append("folderPath", params.folderPath);
  formData.append("file", params.file);

  const response = await apiClient(`/api/user-files/sharepoint/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await readError(response, "SharePoint Upload fehlgeschlagen.");
  }
  const data = await response.json();
  return data.item;
}

export async function downloadSharePointFile(
  sourceId: string,
  filePath: string,
): Promise<{ blob: Blob; filename: string }> {
  const query = new URLSearchParams({ sourceId, filePath });
  const response = await apiClient(
    `/api/user-files/sharepoint/download?${query.toString()}`,
  );
  if (!response.ok) {
    throw await readError(response, "SharePoint Download fehlgeschlagen.");
  }

  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="(.+)"/i);
  const filename =
    fileNameMatch?.[1] ? decodeURIComponent(fileNameMatch[1]) : "download";

  return {
    blob: await response.blob(),
    filename,
  };
}
