import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  FolderIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
} from "../components/ui/primitives";
import {
  createSharePointSource,
  deleteUserFileSource,
  downloadSharePointFile,
  fetchFileProviders,
  fetchUserFileSources,
  FileProviderInfo,
  listSharePointFiles,
  SharePointBrowserItem,
  uploadSharePointFile,
  UserFileSource,
} from "../services/userFilesApi";

const LAST_SELECTED_SOURCE_KEY = "triologue.files.sharepoint.source";

function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parentFolder(pathValue: string): string {
  if (!pathValue || pathValue === "/") return "/";
  const segments = pathValue.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

export const FilesPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [providers, setProviders] = useState<FileProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [sources, setSources] = useState<UserFileSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    () => localStorage.getItem(LAST_SELECTED_SOURCE_KEY) || null,
  );
  const [siteUrl, setSiteUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [creatingSource, setCreatingSource] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState("/");
  const [items, setItems] = useState<SharePointBrowserItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const sharePointProvider = useMemo(
    () => providers.find((provider) => provider.id === "sharepoint") || null,
    [providers],
  );

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) || null,
    [sources, activeSourceId],
  );

  const loadProviders = useCallback(async () => {
    if (!token) return;
    setProvidersLoading(true);
    try {
      const nextProviders = await fetchFileProviders(token);
      setProviders(nextProviders);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Datei-Provider konnten nicht geladen werden.",
      );
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, [token]);

  const loadSources = useCallback(async (preferredSourceId?: string | null) => {
    if (!token) return;
    setSourcesLoading(true);
    try {
      const nextSources = await fetchUserFileSources(token, "sharepoint");
      setSources(nextSources);

      const storedSourceId = localStorage.getItem(LAST_SELECTED_SOURCE_KEY);
      const preferredId =
        nextSources.find((source) => source.id === preferredSourceId)?.id ||
        nextSources.find((source) => source.id === storedSourceId)?.id ||
        nextSources[0]?.id ||
        null;

      setActiveSourceId(preferredId);
      if (!preferredId) {
        setFolderPath("/");
        setItems([]);
      }
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Dateiquellen konnten nicht geladen werden.",
      );
      setSources([]);
      setActiveSourceId(null);
      setItems([]);
    } finally {
      setSourcesLoading(false);
    }
  }, [token]);

  const loadFolder = useCallback(
    async (sourceId: string, nextPath: string) => {
      if (!token) return;
      setListLoading(true);
      try {
        const data = await listSharePointFiles(sourceId, nextPath, token);
        setItems(Array.isArray(data.items) ? data.items : []);
        setFolderPath(data.folderPath || nextPath);
        setRuntimeError(null);
      } catch (error) {
        setRuntimeError(
          error instanceof Error
            ? error.message
            : "SharePoint Dateien konnten nicht geladen werden.",
        );
        setItems([]);
      } finally {
        setListLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    void loadProviders();
  }, [token, navigate, loadProviders]);

  useEffect(() => {
    if (!sharePointProvider?.connected) {
      setSources([]);
      setActiveSourceId(null);
      setItems([]);
      return;
    }
    void loadSources();
  }, [sharePointProvider?.connected, loadSources]);

  useEffect(() => {
    if (!activeSourceId) {
      localStorage.removeItem(LAST_SELECTED_SOURCE_KEY);
      return;
    }
    localStorage.setItem(LAST_SELECTED_SOURCE_KEY, activeSourceId);
  }, [activeSourceId]);

  useEffect(() => {
    if (!activeSource) {
      setFolderPath("/");
      setItems([]);
      return;
    }
    void loadFolder(activeSource.id, "/");
  }, [activeSource?.id, loadFolder]);

  const handleCreateSource = async () => {
    if (!token || !siteUrl.trim()) {
      setRuntimeError("Bitte eine SharePoint Site-URL eingeben.");
      return;
    }

    setCreatingSource(true);
    try {
      const source = await createSharePointSource(
        {
          siteUrl: siteUrl.trim(),
          label: sourceLabel.trim() || undefined,
        },
        token,
      );
      setSiteUrl("");
      setSourceLabel("");
      await loadSources(source.id);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "SharePoint Quelle konnte nicht gespeichert werden.",
      );
    } finally {
      setCreatingSource(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!token) return;

    setDeletingSourceId(sourceId);
    try {
      await deleteUserFileSource(sourceId, token);
      const isActive = activeSourceId === sourceId;
      if (isActive) {
        localStorage.removeItem(LAST_SELECTED_SOURCE_KEY);
      }
      await loadSources(isActive ? undefined : activeSourceId);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Dateiquelle konnte nicht gelöscht werden.",
      );
    } finally {
      setDeletingSourceId(null);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !token || !activeSource) return;

    setUploading(true);
    try {
      await uploadSharePointFile(
        {
          sourceId: activeSource.id,
          folderPath,
          file,
        },
        token,
      );
      await loadFolder(activeSource.id, folderPath);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "SharePoint Upload fehlgeschlagen.",
      );
    } finally {
      event.target.value = "";
      setUploading(false);
    }
  };

  const handleDownload = async (item: SharePointBrowserItem) => {
    if (!token || !activeSource || item.isFolder) return;

    setDownloadingPath(item.path);
    try {
      const { blob, filename } = await downloadSharePointFile(
        activeSource.id,
        item.path,
        token,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "SharePoint Download fehlgeschlagen.",
      );
    } finally {
      setDownloadingPath(null);
    }
  };

  const breadcrumbSegments = useMemo(() => {
    const segments = folderPath.split("/").filter(Boolean);
    const entries = [{ label: "Root", path: "/" }];
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      entries.push({ label: segment, path: current });
    }
    return entries;
  }, [folderPath]);

  return (
    <PageShell
      maxWidth="6xl"
      title="Dateien"
      subtitle="Usergebundener Zugriff auf externe Dateien. SharePoint-Quellen werden pro Nutzer gespeichert."
    >
      <div className="space-y-5">
        <div>
          <Link
            to="/settings"
            className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
          >
            &larr; Zurück zu den Einstellungen
          </Link>
        </div>

        {runtimeError && (
          <Card
            tone="muted"
            className={`p-3 text-sm border ${
              isDark
                ? "border-red-700/60 text-red-300"
                : "border-red-200 text-red-700"
            }`}
          >
            {runtimeError}
          </Card>
        )}

        <Card className="p-4 sm:p-5">
          <SectionHeader
            title="Provider"
            subtitle="Nur von Triologue aktivierte Storage-Connectoren werden hier angeboten."
          />

          {providersLoading ? (
            <div className="text-sm">Laden...</div>
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<FolderIcon className="w-8 h-8" />}
              title="Keine Storage-Provider gefunden"
              description="Sobald Triologue weitere Storage-Connectoren aktiviert, erscheinen sie hier."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {providers.map((provider) => (
                <Card key={provider.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div
                        className={`font-semibold ${
                          isDark ? "text-white" : "text-gray-900"
                        }`}
                      >
                        {provider.name}
                      </div>
                      <div
                        className={`text-xs ${
                          isDark ? "text-gray-400" : "text-gray-600"
                        }`}
                      >
                        {provider.provider} · {provider.category}
                      </div>
                    </div>
                    <Badge variant={provider.connected ? "success" : "warning"}>
                      {provider.connected ? "Persoenlich verbunden" : "Nicht verbunden"}
                    </Badge>
                  </div>

                  <div
                    className={`text-sm ${
                      isDark ? "text-gray-300" : "text-gray-700"
                    }`}
                  >
                    {provider.id === "sharepoint"
                      ? "SharePoint-Quellen können gespeichert und anschließend im Dateien-Modul genutzt werden."
                      : "Dieser Provider ist freigeschaltet, aber im Dateien-MVP noch nicht umgesetzt."}
                  </div>

                  {!provider.connected && (
                    <div>
                      <Link
                        to={provider.connectionPath}
                        className={`text-sm hover:underline ${
                          isDark ? "text-blue-400" : "text-blue-600"
                        }`}
                      >
                        Verbindung in den Einstellungen anlegen
                      </Link>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHeader
            title="SharePoint-Quellen"
            subtitle="Gespeicherte Dateiquellen pro Nutzer. Eine Quelle referenziert genau eine Team Site bzw. Library."
          />

          {!sharePointProvider?.connected ? (
            <EmptyState
              icon={<FolderIcon className="w-8 h-8" />}
              title="SharePoint ist noch nicht verbunden"
              description="Verbinde zuerst deinen persönlichen SharePoint-Account in den Einstellungen."
              action={
                <Link to="/settings/connections">
                  <Button type="button" variant="primary">
                    Zu meinen Verbindungen
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-3 items-end">
                <div>
                  <label
                    className={`block text-xs mb-1 ${
                      isDark ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    SharePoint Site-URL
                  </label>
                  <Input
                    value={siteUrl}
                    onChange={(event) => setSiteUrl(event.target.value)}
                    placeholder="https://tenant.sharepoint.com/sites/projekt"
                  />
                </div>
                <div>
                  <label
                    className={`block text-xs mb-1 ${
                      isDark ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Anzeigename
                  </label>
                  <Input
                    value={sourceLabel}
                    onChange={(event) => setSourceLabel(event.target.value)}
                    placeholder="z. B. Kunde Nord"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void handleCreateSource()}
                  disabled={creatingSource}
                >
                  {creatingSource ? "Speichere..." : "Quelle speichern"}
                </Button>
              </div>

              {sourcesLoading ? (
                <div className="text-sm">Quellen werden geladen...</div>
              ) : sources.length === 0 ? (
                <EmptyState
                  icon={<FolderIcon className="w-8 h-8" />}
                  title="Noch keine SharePoint-Quelle gespeichert"
                  description="Lege oben die erste Team Site an. Danach kannst du direkt darin browsen."
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {sources.map((source) => {
                    const isActive = source.id === activeSourceId;
                    return (
                      <Card
                        key={source.id}
                        className={`p-4 space-y-3 ${
                          isActive
                            ? isDark
                              ? "ring-1 ring-blue-600/70"
                              : "ring-1 ring-blue-300"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div
                              className={`font-semibold ${
                                isDark ? "text-white" : "text-gray-900"
                              }`}
                            >
                              {source.label}
                            </div>
                            <div
                              className={`text-xs ${
                                isDark ? "text-gray-400" : "text-gray-600"
                              }`}
                            >
                              {source.siteName} · {source.driveName}
                            </div>
                          </div>
                          <Badge variant={isActive ? "info" : "neutral"}>
                            {isActive ? "Aktiv" : "Quelle"}
                          </Badge>
                        </div>

                        <div
                          className={`text-xs break-all ${
                            isDark ? "text-gray-400" : "text-gray-600"
                          }`}
                        >
                          {source.siteUrl}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={isActive ? "secondary" : "primary"}
                            onClick={() => setActiveSourceId(source.id)}
                          >
                            {isActive ? "Aktiv" : "Auswählen"}
                          </Button>
                          <a
                            href={source.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1 text-sm px-2 py-1.5 ${
                              isDark ? "text-blue-400" : "text-blue-600"
                            }`}
                          >
                            Öffnen
                            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                          </a>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleDeleteSource(source.id)}
                            disabled={deletingSourceId === source.id}
                            className="inline-flex items-center gap-1"
                          >
                            <TrashIcon className="w-4 h-4" />
                            {deletingSourceId === source.id ? "Loesche..." : "Entfernen"}
                          </Button>
                        </div>

                        <div
                          className={`text-xs ${
                            isDark ? "text-gray-500" : "text-gray-500"
                          }`}
                        >
                          Aktualisiert: {formatDate(source.updatedAt)}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="p-4 sm:p-5 space-y-4">
          <SectionHeader
            title="Dateibrowser"
            subtitle="Arbeitet immer auf der aktuell ausgewählten Quelle."
          />

          {!activeSource ? (
            <EmptyState
              icon={<FolderIcon className="w-8 h-8" />}
              title="Keine aktive Quelle"
              description="Wähle zuerst eine gespeicherte SharePoint-Quelle aus."
            />
          ) : (
            <>
              <div
                className={`rounded-xl border p-4 ${
                  isDark
                    ? "border-gray-700/60 bg-gray-800/50"
                    : "border-gray-200/70 bg-gray-50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div>
                    <div
                      className={`font-semibold ${
                        isDark ? "text-white" : "text-gray-900"
                      }`}
                    >
                      {activeSource.label}
                    </div>
                    <div
                      className={`text-xs ${
                        isDark ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      {activeSource.siteName} · Drive: {activeSource.driveName}
                    </div>
                  </div>
                  <a
                    href={activeSource.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-sm inline-flex items-center gap-1 ${
                      isDark ? "text-blue-400" : "text-blue-600"
                    }`}
                  >
                    Im SharePoint öffnen
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {breadcrumbSegments.map((segment, index) => (
                  <button
                    key={segment.path}
                    type="button"
                    onClick={() => void loadFolder(activeSource.id, segment.path)}
                    className={`inline-flex items-center gap-1 text-sm ${
                      isDark ? "text-blue-300" : "text-blue-700"
                    }`}
                  >
                    {index > 0 && <ChevronRightIcon className="w-4 h-4" />}
                    {segment.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadFolder(activeSource.id, "/")}
                  disabled={listLoading}
                >
                  Root
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void loadFolder(activeSource.id, parentFolder(folderPath))
                  }
                  disabled={listLoading || folderPath === "/"}
                >
                  Eine Ebene hoch
                </Button>
                <label>
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(event) => void handleUpload(event)}
                    disabled={uploading}
                  />
                  <span>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={uploading}
                      className="inline-flex items-center gap-2"
                    >
                      <CloudArrowUpIcon className="w-4 h-4" />
                      {uploading ? "Upload..." : "Datei hochladen"}
                    </Button>
                  </span>
                </label>
              </div>

              <div
                className={`rounded-xl border overflow-hidden ${
                  isDark ? "border-gray-700/60" : "border-gray-200/70"
                }`}
              >
                <div
                  className={`grid grid-cols-[minmax(0,1.8fr)_120px_170px_170px] gap-3 px-4 py-3 text-xs font-semibold ${
                    isDark
                      ? "bg-gray-800 text-gray-300"
                      : "bg-gray-50 text-gray-600"
                  }`}
                >
                  <div>Name</div>
                  <div>Größe</div>
                  <div>Geändert</div>
                  <div>Aktionen</div>
                </div>

                {listLoading ? (
                  <div className="p-4 text-sm">Lade Ordnerinhalt...</div>
                ) : items.length === 0 ? (
                  <div className="p-4 text-sm">Dieser Ordner ist leer.</div>
                ) : (
                  items.map((item) => (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[minmax(0,1.8fr)_120px_170px_170px] gap-3 px-4 py-3 text-sm border-t ${
                        isDark
                          ? "border-gray-800/80 text-gray-200"
                          : "border-gray-100 text-gray-800"
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {item.isFolder ? (
                          <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
                        ) : (
                          <DocumentIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />
                        )}
                        <button
                          type="button"
                          className={`truncate text-left ${
                            item.isFolder
                              ? isDark
                                ? "text-amber-300"
                                : "text-amber-700"
                              : isDark
                                ? "text-white"
                                : "text-gray-900"
                          }`}
                          onClick={() => {
                            if (item.isFolder && activeSource) {
                              void loadFolder(activeSource.id, item.path);
                            }
                          }}
                        >
                          {item.name}
                        </button>
                      </div>
                      <div className={isDark ? "text-gray-400" : "text-gray-600"}>
                        {item.isFolder
                          ? `${item.childCount ?? 0} Einträge`
                          : formatFileSize(item.size)}
                      </div>
                      <div className={isDark ? "text-gray-400" : "text-gray-600"}>
                        {formatDate(item.lastModified)}
                      </div>
                      <div className="flex items-center gap-2">
                        {!item.isFolder && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleDownload(item)}
                            disabled={downloadingPath === item.path}
                            className="inline-flex items-center gap-1"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            {downloadingPath === item.path ? "..." : "Download"}
                          </Button>
                        )}
                        <a
                          href={item.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 text-xs ${
                            isDark ? "text-blue-400" : "text-blue-600"
                          }`}
                        >
                          Öffnen
                          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </PageShell>
  );
};
