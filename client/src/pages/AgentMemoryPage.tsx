import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { PageShell } from "../components/ui/PageShell";
import { Badge, Button, Card, EmptyState, Input, Select } from "../components/ui/primitives";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import {
  EMPTY_MEMORY_PAYLOAD_DRAFT,
  MEMORY_TYPE_OPTIONS,
  buildPayloadForMemoryType,
  fetchMemoryProjects,
  memoryApi,
  parseTags,
  type MemoryEntry,
  type MemoryListResponse,
  type MemoryPayloadDraft,
  type MemoryProject,
  type MemoryScope,
  type MemoryType,
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
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [scopeFilter, setScopeFilter] = useState<MemoryScope>(DEFAULT_SCOPE_FILTER);
  const [filterProjectId, setFilterProjectId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [createScope, setCreateScope] = useState<Exclude<MemoryScope, "ALL">>("GLOBAL");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [createConfidence, setCreateConfidence] = useState("0.72");
  const [createType, setCreateType] = useState<MemoryType>("core.note");
  const [createDraft, setCreateDraft] = useState<MemoryPayloadDraft>(EMPTY_MEMORY_PAYLOAD_DRAFT);

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
      } catch (err: any) {
        if (seq === requestSeq.current) {
          setError(err?.message || t("memory.error.load"));
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

  const updateCreateDraft = (field: keyof MemoryPayloadDraft, value: string) => {
    setCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const renderTypedFields = () => {
    if (createType === "risk") {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.severity")}
            </label>
            <Select value={createDraft.severity} onChange={(event) => updateCreateDraft("severity", event.target.value)}>
              <option value="">{t("memory.fields.select")}</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.impact")}
            </label>
            <Input value={createDraft.impact} onChange={(event) => updateCreateDraft("impact", event.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.mitigation")}
            </label>
            <Input value={createDraft.mitigation} onChange={(event) => updateCreateDraft("mitigation", event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.sourceRef")}
            </label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.evidenceUrl")}
            </label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "decision") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.decision")}
            </label>
            <Input value={createDraft.decision} onChange={(event) => updateCreateDraft("decision", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.rationale")}
            </label>
            <Input value={createDraft.rationale} onChange={(event) => updateCreateDraft("rationale", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.sourceRef")}
            </label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.evidenceUrl")}
            </label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "resource") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.resourceKind")}
            </label>
            <Input value={createDraft.resourceKind} onChange={(event) => updateCreateDraft("resourceKind", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.resourceRef")}
            </label>
            <Input value={createDraft.resourceRef} onChange={(event) => updateCreateDraft("resourceRef", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.sourceRef")}
            </label>
            <Input value={createDraft.sourceRef} onChange={(event) => updateCreateDraft("sourceRef", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.evidenceUrl")}
            </label>
            <Input value={createDraft.evidenceUrl} onChange={(event) => updateCreateDraft("evidenceUrl", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "constraint") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.constraint")}
            </label>
            <Input value={createDraft.constraint} onChange={(event) => updateCreateDraft("constraint", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.scopeHint")}
            </label>
            <Input value={createDraft.scopeHint} onChange={(event) => updateCreateDraft("scopeHint", event.target.value)} />
          </div>
        </div>
      );
    }

    if (createType === "handover") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.nextAction")}
            </label>
            <Input value={createDraft.nextAction} onChange={(event) => updateCreateDraft("nextAction", event.target.value)} />
          </div>
          <div>
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("memory.fields.owner")}
            </label>
            <Input value={createDraft.owner} onChange={(event) => updateCreateDraft("owner", event.target.value)} />
          </div>
        </div>
      );
    }

    return null;
  };

  const saveEntry = async () => {
    if (!createDraft.note.trim()) {
      const msg = t("memory.error.noteRequired");
      setError(msg);
      toast.error(msg);
      return;
    }
    if (createScope === "PROJECT" && !createProjectId) {
      const msg = t("memory.error.projectRequired");
      setError(msg);
      toast.error(msg);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await memoryApi("/api/memory", {
        method: "POST",
        body: JSON.stringify({
          scope: createScope,
          projectId: createScope === "PROJECT" ? createProjectId : undefined,
          memoryType: createType,
          title: createTitle.trim(),
          note: createDraft.note.trim(),
          payload: buildPayloadForMemoryType(createType, createDraft),
          tags: parseTags(createTags),
          confidence: Number(createConfidence),
          expiresAt: createDraft.validUntil ? createDraft.validUntil : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Save failed (${response.status})`));
      }

      setCreateTitle("");
      setCreateTags("");
      setCreateType("core.note");
      setCreateConfidence("0.72");
      setCreateDraft(EMPTY_MEMORY_PAYLOAD_DRAFT);
      setShowCreate(false);
      toast.success(t("memory.toast.saved"));
      await reloadFirstPage();
    } catch (err: any) {
      const msg = err?.message || t("memory.error.save");
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

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🧠 {t("memory.title")}</span>}
      subtitle={t("memory.subtitle")}
      actions={
        <Button type="button" size="sm" onClick={() => setShowCreate((value) => !value)}>
          {t("memory.create.title")}
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

        {showCreate && (
          <Card
            className={`rounded-xl border-l-4 border-blue-500 p-3 sm:p-4 ${
              isDark ? "border border-gray-700 bg-gray-800/80" : "border border-blue-100 bg-blue-50"
            }`}
          >
          <div className="mb-2 text-sm font-semibold">{t("memory.create.title")}</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.scope")}
              </label>
              <Select
                value={createScope}
                onChange={(event) => {
                  const nextScope = event.target.value as Exclude<MemoryScope, "ALL">;
                  setCreateScope(nextScope);
                  if (nextScope !== "PROJECT") setCreateProjectId("");
                }}
              >
                <option value="PROJECT">{t("memory.scope.project")}</option>
                <option value="GLOBAL">{t("memory.scope.global")}</option>
              </Select>
            </div>
            <div>
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.project")}
              </label>
              <Select
                value={createProjectId}
                onChange={(event) => setCreateProjectId(event.target.value)}
                disabled={createScope !== "PROJECT"}
              >
                <option value="">{t("memory.filter.projectPlaceholder")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.type")}
              </label>
              <Select value={createType} onChange={(event) => setCreateType(event.target.value as MemoryType)}>
                {MEMORY_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {t(`memory.type.${type}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.confidence")}
              </label>
              <Input
                value={createConfidence}
                onChange={(event) => setCreateConfidence(event.target.value)}
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            <div className="xl:col-span-1">
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.titleLabel")}
              </label>
              <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </div>
            <div className="xl:col-span-1">
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.tags")}
              </label>
              <Input
                value={createTags}
                onChange={(event) => setCreateTags(event.target.value)}
                placeholder={t("memory.create.tagsPlaceholder")}
              />
            </div>
            <div className="xl:col-span-2">
              <label className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.create.note")}
              </label>
              <textarea
                value={createDraft.note}
                onChange={(event) => updateCreateDraft("note", event.target.value)}
                placeholder={t("memory.create.notePlaceholder")}
                className={`w-full min-h-[86px] resize-y rounded-lg border px-3 py-2 text-sm ${
                  isDark
                    ? "border-gray-700 bg-gray-900 text-gray-100 placeholder:text-gray-500"
                    : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                }`}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.fields.owner")}
              </label>
              <Input value={createDraft.owner} onChange={(event) => updateCreateDraft("owner", event.target.value)} />
            </div>
            <div>
              <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.fields.lastValidatedAt")}
              </label>
              <Input
                type="date"
                value={createDraft.lastValidatedAt}
                onChange={(event) => updateCreateDraft("lastValidatedAt", event.target.value)}
              />
            </div>
            <div>
              <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {t("memory.fields.validUntil")}
              </label>
              <Input
                type="date"
                value={createDraft.validUntil}
                onChange={(event) => updateCreateDraft("validUntil", event.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">{renderTypedFields()}</div>

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" onClick={() => void saveEntry()} disabled={saving}>
              {saving ? t("common.loading") : t("memory.create.save")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
              {t("memory.list.cancel")}
            </Button>
          </div>
          </Card>
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
            <Select value={filterProjectId} onChange={(event) => setFilterProjectId(event.target.value)}>
              <option value="">{t("memory.filter.projectPlaceholder")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
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
          icon="🧠"
          action={
            <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
              {t("memory.create.title")}
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
                    className={`p-3 transition ${
                      isDark ? "hover:border-blue-500 hover:bg-gray-800" : "hover:border-blue-400 hover:shadow-sm"
                    }`}
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
                          variant="secondary"
                          className="h-8 min-w-[88px] justify-center whitespace-nowrap"
                          onClick={() => navigate(`/memory/${entry.id}`)}
                        >
                          {t("memory.list.details")}
                        </Button>
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
                <Card key={entry.id} className="p-3">
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
                    <Button type="button" size="sm" variant="secondary" onClick={() => navigate(`/memory/${entry.id}`)}>
                      {t("memory.list.details")}
                    </Button>
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
    </PageShell>
  );
};
