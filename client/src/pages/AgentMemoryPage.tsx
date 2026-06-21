import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { CubeTransparentIcon } from "@heroicons/react/24/outline";
import { PageShell } from "../components/ui/PageShell";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Badge, Button, Card, EmptyState, Input, Select } from "../components/ui/primitives";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  fetchMemoryProjects,
  memoryApi,
  type MemoryEntry,
  type MemoryListResponse,
  type MemoryProject,
  type MemoryScope,
} from "./memoryApi";

const PAGE_SIZE = 10;
const SCOPE_FILTERS: MemoryScope[] = ["PROJECT", "ALL", "GLOBAL"];
const DEFAULT_SCOPE_FILTER: MemoryScope = "PROJECT";

export const AgentMemoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === "dark";

  const [projects, setProjects] = useState<MemoryProject[]>([]);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryEntry | null>(null);

  const [scopeFilter, setScopeFilter] = useState<MemoryScope>(DEFAULT_SCOPE_FILTER);
  const [filterProjectId, setFilterProjectId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const requestSeq = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(timeout);
  }, [query]);

  const loadProjects = useCallback(async () => {
    try {
      const normalized = await fetchMemoryProjects();
      setProjects(normalized);
    } catch {
      // best effort
    }
  }, []);

  const fetchPage = useCallback(
    async (cursor: string | null, history: Array<string | null>) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        params.set("scope", scopeFilter);
        params.set("limit", String(PAGE_SIZE));
        if (filterProjectId) params.set("projectId", filterProjectId);
        if (debouncedQuery) params.set("search", debouncedQuery);
        if (includeArchived) params.set("includeArchived", "true");
        if (cursor) params.set("cursor", cursor);

        const response = await memoryApi(`/api/memory?${params.toString()}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(data?.error || `Load failed (${response.status})`));
        }
        if (seq !== requestSeq.current) return;

        const payload: MemoryListResponse = Array.isArray(data)
          ? {
              items: data,
              totalCount: data.length,
              pageInfo: { limit: PAGE_SIZE, hasMore: false, nextCursor: null },
            }
          : data;

        setEntries(Array.isArray(payload?.items) ? payload.items : []);
        setTotalCount(payload?.totalCount ?? (Array.isArray(payload?.items) ? payload.items.length : 0));
        setHasMore(Boolean(payload.pageInfo?.hasMore));
        setNextCursor(payload.pageInfo?.nextCursor ?? null);
        setCurrentCursor(cursor);
        setCursorHistory(history);
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : t("memory.error.load"));
          setEntries([]);
          setTotalCount(0);
          setHasMore(false);
          setNextCursor(null);
          setCurrentCursor(cursor);
          setCursorHistory(history);
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [scopeFilter, filterProjectId, debouncedQuery, includeArchived, t],
  );

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void fetchPage(null, []);
  }, [fetchPage]);

  const reloadFirstPage = async () => {
    await fetchPage(null, []);
  };

  const handleNextPage = async () => {
    if (!hasMore || !nextCursor) return;
    const nextHistory = [...cursorHistory, currentCursor];
    await fetchPage(nextCursor, nextHistory);
  };

  const handlePrevPage = async () => {
    if (cursorHistory.length === 0) return;
    const targetCursor = cursorHistory[cursorHistory.length - 1] ?? null;
    const nextHistory = cursorHistory.slice(0, -1);
    await fetchPage(targetCursor, nextHistory);
  };

  const requestDeleteEntry = (entry: MemoryEntry) => {
    if (!entry.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }
    setDeleteTarget(entry);
    setConfirmDeleteOpen(true);
  };

  const deleteEntry = async () => {
    if (!deleteTarget) return;
    if (!deleteTarget.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(deleteTarget.id)}/permanent`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Delete failed (${response.status})`));
      }
      toast.success(t("memory.toast.deleted"));
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      await reloadFirstPage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("memory.error.delete");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const currentPage = cursorHistory.length + 1;
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + entries.length - 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const resultsText = t("pagination.results")
    .replace("{start}", String(pageStart))
    .replace("{end}", String(pageEnd))
    .replace("{total}", String(totalCount));
  const pageInfoText = t("pagination.pageInfo")
    .replace("{page}", String(Math.min(currentPage, totalPages)))
    .replace("{total}", String(totalPages));
  const openMemory = (memoryId: string) => navigate(`/memory/${memoryId}`);
  const openMemoryLabel = (name: string) =>
    t("memory.a11y.openEntry").replace("{name}", name || t("memory.list.untitled"));
  const deleteMemoryLabel = (name: string) =>
    t("memory.a11y.deleteEntry").replace("{name}", name || t("memory.list.untitled"));

  return (
    <PageShell
      maxWidth="6xl"
      title={t("memory.title")}
      subtitle={t("memory.subtitle")}
      actions={
        <Button type="button" size="sm" onClick={() => navigate("/memory/new")}>
          {t("common.createAction")}
        </Button>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
            {error}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 !px-1.5 !py-0.5"
              onClick={() => setError("")}
            >
              ✕
            </Button>
          </div>
        )}

        <Card tone="muted" className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            <Input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("memory.filter.searchPlaceholder")}
              className="md:max-w-md"
            />
            <div className="flex flex-wrap items-center gap-2">
              {SCOPE_FILTERS.map((scope) => (
                <Button
                  key={scope}
                  type="button"
                  size="sm"
                  variant={scopeFilter === scope ? "primary" : "secondary"}
                  className="rounded-full"
                  onClick={() => setScopeFilter(scope)}
                >
                  {scope === "PROJECT"
                    ? t("memory.scope.project")
                    : scope === "GLOBAL"
                      ? t("memory.scope.global")
                      : t("memory.scope.all")}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={includeArchived ? "primary" : "secondary"}
                onClick={() => setIncludeArchived((value) => !value)}
              >
                {t("memory.filter.includeArchived")}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Select 
                value={filterProjectId} 
                onChange={(value) => setFilterProjectId(value)}
                placeholder={t("memory.filter.projectPlaceholder")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={() => void reloadFirstPage()} disabled={loading}>
                  {loading ? t("common.loading") : t("memory.filter.refresh")}
                </Button>
                {(query || filterProjectId || scopeFilter !== DEFAULT_SCOPE_FILTER || includeArchived) && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setQuery("");
                      setFilterProjectId("");
                      setScopeFilter(DEFAULT_SCOPE_FILTER);
                      setIncludeArchived(false);
                    }}
                  >
                    {t("memory.filters.reset")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title={t("memory.list.empty")}
            icon={<CubeTransparentIcon className="w-8 h-8" />}
            action={
              <Button type="button" size="sm" onClick={() => navigate("/memory/new")}>
                {t("common.createAction")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <div
                className={`grid grid-cols-12 gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide ${
                  isDark ? "text-gray-400" : "text-gray-500"
                }`}
              >
                <div className="col-span-4">{t("memory.list.name")}</div>
                <div className="col-span-2">{t("memory.list.scope")}</div>
                <div className="col-span-2">{t("memory.create.type")}</div>
                <div className="col-span-2">{t("memory.list.updatedAt")}</div>
                <div className="col-span-2 text-right">{t("memory.list.actions")}</div>
              </div>
              <div className="space-y-2">
                {entries.map((entry) => {
                  const tags = Array.isArray(entry.tags) ? entry.tags : [];
                  const note = String(entry.payload?.note || entry.summary || "");

                  return (
                    <Card
                      key={entry.id}
                      className={`p-3 transition cursor-pointer ${
                        isDark ? "hover:border-blue-500 hover:bg-gray-800" : "hover:border-blue-400 hover:shadow-sm"
                      }`}
                      onClick={() => openMemory(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openMemory(entry.id);
                        }
                      }}
                      role="link"
                      tabIndex={0}
                      title={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                      aria-label={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                    >
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-4 min-w-0">
                          <div className="font-semibold truncate">{entry.title || t("memory.list.untitled")}</div>
                          <div className={`mt-1 text-sm line-clamp-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                            {note || "-"}
                          </div>
                          {tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {tags.map((tag) => (
                                <Badge key={`${entry.id}:${tag}`} variant="neutral">
                                  #{tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Badge variant={entry.scope === "GLOBAL" ? "warning" : "info"}>{entry.scope}</Badge>
                          {entry.projectName && <Badge variant="neutral">{entry.projectName}</Badge>}
                          {entry.archivedAt && <Badge variant="danger">{t("memory.list.archived")}</Badge>}
                          {entry.freshnessStatus === "stale" && <Badge variant="danger">{t("memory.list.stale")}</Badge>}
                        </div>
                        <div className="col-span-2">
                          <Badge variant="neutral">{entry.memoryType}</Badge>
                        </div>
                        <div className={`col-span-2 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                          <div>{new Date(entry.updatedAt).toLocaleString()}</div>
                          <div className="mt-1">
                            {t("memory.list.confidence")}: {Math.round((entry.confidence || 0) * 100)}%
                          </div>
                        </div>
                        <div className="col-span-2 flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            className="h-8 min-w-[88px] justify-center whitespace-nowrap"
                            title={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                            aria-label={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                            onClick={(e) => {
                              e.stopPropagation();
                              openMemory(entry.id);
                            }}
                          >
                            {t("memory.list.details")}
                          </Button>
                          {entry.editable && (
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              className="h-8 min-w-[88px] justify-center whitespace-nowrap"
                              title={deleteMemoryLabel(entry.title || t("memory.list.untitled"))}
                              aria-label={deleteMemoryLabel(entry.title || t("memory.list.untitled"))}
                              onClick={(e) => {
                                e.stopPropagation();
                                requestDeleteEntry(entry);
                              }}
                            >
                              {t("memory.list.delete")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 md:hidden">
              {entries.map((entry) => {
                const tags = Array.isArray(entry.tags) ? entry.tags : [];
                const note = String(entry.payload?.note || entry.summary || "");

                return (
                  <Card
                    key={entry.id}
                    className={`p-3 transition cursor-pointer ${
                      isDark ? "hover:border-blue-500 hover:bg-gray-800" : "hover:border-blue-400 hover:shadow-sm"
                    }`}
                    onClick={() => openMemory(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openMemory(entry.id);
                      }
                    }}
                    role="link"
                    tabIndex={0}
                    title={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                    aria-label={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                  >
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge variant={entry.scope === "GLOBAL" ? "warning" : "info"}>{entry.scope}</Badge>
                      <Badge variant="neutral">{entry.memoryType}</Badge>
                      {entry.projectName && <Badge variant="neutral">{entry.projectName}</Badge>}
                      {entry.archivedAt && <Badge variant="danger">{t("memory.list.archived")}</Badge>}
                      {entry.freshnessStatus === "stale" && <Badge variant="danger">{t("memory.list.stale")}</Badge>}
                    </div>
                    <div className="text-sm font-semibold">{entry.title || t("memory.list.untitled")}</div>
                    <div className={`mt-1 text-sm whitespace-pre-wrap ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                      {note || "-"}
                    </div>
                    {tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge key={`${entry.id}:${tag}`} variant="neutral">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className={`mt-2 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                      {t("memory.list.confidence")}: {Math.round((entry.confidence || 0) * 100)}% · {t("memory.list.updatedAt")}: {new Date(entry.updatedAt).toLocaleString()}
                    </div>
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          aria-label={openMemoryLabel(entry.title || t("memory.list.untitled"))}
                          onClick={(e) => {
                            e.stopPropagation();
                            openMemory(entry.id);
                          }}
                        >
                          {t("memory.list.details")}
                        </Button>
                        {entry.editable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            aria-label={deleteMemoryLabel(entry.title || t("memory.list.untitled"))}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteEntry(entry);
                            }}
                          >
                            {t("memory.list.delete")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card tone="muted" className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{resultsText}</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={cursorHistory.length === 0 || loading}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <span className={`text-sm min-w-[90px] text-center ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                    {pageInfoText}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={!hasMore || !nextCursor || loading}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("memory.detail.deleteConfirmTitle")}
        message={t("memory.detail.deleteConfirmMessage")}
        confirmLabel={t("memory.list.delete")}
        cancelLabel={t("memory.list.cancel")}
        variant="danger"
        loading={saving}
        onConfirm={() => void deleteEntry()}
        onCancel={() => {
          if (!saving) {
            setConfirmDeleteOpen(false);
            setDeleteTarget(null);
          }
        }}
      />
    </PageShell>
  );
};
