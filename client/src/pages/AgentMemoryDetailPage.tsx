import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { CubeTransparentIcon } from "@heroicons/react/24/outline";
import { PageShell } from "../components/ui/PageShell";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Badge, Button, Card, EmptyState } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { formatDate, memoryApi, toMemoryType, toPayloadDraft, type MemoryEntry } from "./memoryApi";
import { LoadingSpinner } from "../components/ui";

export const AgentMemoryDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { memoryId = "" } = useParams<{ memoryId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [entry, setEntry] = useState<MemoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadEntry = useCallback(async () => {
    if (!memoryId) return;
    setLoading(true);
    setError("");

    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(memoryId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Load failed (${response.status})`));
      }
      setEntry(data as MemoryEntry);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.error.load"));
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [memoryId, t]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  const archiveEntry = async () => {
    if (!entry?.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Archive failed (${response.status})`));
      }
      toast.success(t("memory.toast.archived"));
      setConfirmArchiveOpen(false);
      await loadEntry();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("memory.error.archive");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!entry?.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(entry.id)}/permanent`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Delete failed (${response.status})`));
      }
      toast.success(t("memory.toast.deleted"));
      setConfirmDeleteOpen(false);
      navigate("/memory");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("memory.error.delete");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const restoreEntry = async () => {
    if (!entry?.editable) {
      toast.error(t("memory.error.notEditable"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await memoryApi(`/api/memory/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || `Restore failed (${response.status})`));
      }
      toast.success(t("memory.toast.updated"));
      await loadEntry();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("memory.error.update");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const downloadJson = (data: unknown, fileName: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const fileUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(fileUrl);
  };

  const handleExport = () => {
    if (!entry || exporting) return;
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const stamp = exportedAt.replace(/[:.]/g, "-");
      downloadJson(
        {
          exportedAt,
          kind: "memory-entry",
          item: entry,
        },
        `memory-${entry.id}-${stamp}.json`,
      );
    } catch (err) {
      console.error(err);
      toast.error(t("memory.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  const draft = useMemo(() => toPayloadDraft(entry), [entry]);
  const memoryType = useMemo(() => toMemoryType(entry?.memoryType), [entry?.memoryType]);
  const note = String(draft.note || entry?.summary || "");
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];

  const typedItems = useMemo(() => {
    if (!entry) return [] as Array<{ label: string; value: string }>;
    if (memoryType === "risk") {
      return [
        { label: t("memory.fields.severity"), value: draft.severity },
        { label: t("memory.fields.impact"), value: draft.impact },
        { label: t("memory.fields.mitigation"), value: draft.mitigation },
        { label: t("memory.fields.sourceRef"), value: draft.sourceRef },
        { label: t("memory.fields.evidenceUrl"), value: draft.evidenceUrl },
      ];
    }
    if (memoryType === "decision") {
      return [
        { label: t("memory.fields.decision"), value: draft.decision },
        { label: t("memory.fields.rationale"), value: draft.rationale },
        { label: t("memory.fields.sourceRef"), value: draft.sourceRef },
        { label: t("memory.fields.evidenceUrl"), value: draft.evidenceUrl },
      ];
    }
    if (memoryType === "resource") {
      return [
        { label: t("memory.fields.resourceKind"), value: draft.resourceKind },
        { label: t("memory.fields.resourceRef"), value: draft.resourceRef },
        { label: t("memory.fields.sourceRef"), value: draft.sourceRef },
        { label: t("memory.fields.evidenceUrl"), value: draft.evidenceUrl },
      ];
    }
    if (memoryType === "constraint") {
      return [
        { label: t("memory.fields.constraint"), value: draft.constraint },
        { label: t("memory.fields.scopeHint"), value: draft.scopeHint },
      ];
    }
    if (memoryType === "handover") {
      return [
        { label: t("memory.fields.nextAction"), value: draft.nextAction },
        { label: t("memory.fields.owner"), value: draft.owner },
      ];
    }
    return [];
  }, [draft, entry, memoryType, t]);

  return (
    <PageShell
      maxWidth="4xl"
      title={t("memory.detail.title")}
      subtitle={t("memory.detail.subtitle")}
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" className="h-8 px-3 whitespace-nowrap" onClick={() => navigate("/memory")}>
            {t("memory.detail.back")}
          </Button>
          {entry && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 min-w-[92px] justify-center whitespace-nowrap"
              onClick={() => void handleExport()}
              disabled={exporting}
            >
              {exporting ? t("memory.actions.exporting") : t("memory.actions.export")}
            </Button>
          )}
          {entry?.editable && !entry.archivedAt && (
            <Button type="button" size="sm" className="h-8 min-w-[92px] justify-center whitespace-nowrap" onClick={() => navigate(`/memory/${entry.id}/edit`)}>
              {t("memory.list.edit")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
            {error}
          </div>
        )}
        {!error && entry?.freshnessStatus === "stale" && (
          <div className={`rounded border px-3 py-2 text-sm ${isDark ? "border-amber-600 bg-amber-900/30 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {entry.freshnessWarning || t("memory.detail.staleWarning")}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <LoadingSpinner />
          </div>
        ) : !entry ? (
          <EmptyState
            title={t("memory.detail.notFound")}
            icon={<CubeTransparentIcon className="w-8 h-8" />}
            action={
              <Link to="/memory">
                <Button type="button" size="sm" variant="secondary">
                  {t("memory.detail.back")}
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-semibold break-words">{entry.title || t("memory.list.untitled")}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={entry.scope === "GLOBAL" ? "warning" : "info"}>{entry.scope}</Badge>
                    <Badge variant="neutral">{t(`memory.type.${memoryType}`)}</Badge>
                    {entry.projectName && <Badge variant="neutral">{entry.projectName}</Badge>}
                    {entry.archivedAt && <Badge variant="danger">{t("memory.list.archived")}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {entry.editable && !entry.archivedAt && (
                    <>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setConfirmArchiveOpen(true)}
                        disabled={saving}
                      >
                        {t("memory.list.archive")}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={saving}
                      >
                        {t("memory.list.delete")}
                      </Button>
                    </>
                  )}
                  {entry.editable && entry.archivedAt && (
                    <>
                      <Button type="button" onClick={() => void restoreEntry()} disabled={saving}>
                        {t("memory.list.restore")}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={saving}
                      >
                        {t("memory.list.delete")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-2">{t("memory.create.note")}</h3>
            <p className={`whitespace-pre-wrap text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}>{note || "-"}</p>
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-3">{t("memory.detail.meta")}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.list.scope")}</div>
                <div className="font-medium">{entry.scope}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.create.project")}</div>
                <div className="font-medium">{entry.projectName || "-"}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.list.confidence")}</div>
                <div className="font-medium">{Math.round((entry.confidence || 0) * 100)}%</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.list.createdAt")}</div>
                <div className="font-medium">{formatDate(entry.createdAt)}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.list.updatedAt")}</div>
                <div className="font-medium">{formatDate(entry.updatedAt)}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.detail.createdBy")}</div>
                <div className="font-medium">{entry.createdBy?.displayName || entry.createdBy?.username || "-"}</div>
              </div>
            </div>

            <div className="mt-4">
              <div className={`mb-2 text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>{t("memory.create.tags")}</div>
              {tags.length === 0 ? (
                <div className="text-sm">-</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={`${entry.id}:${tag}`} variant="neutral">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-3">{t("memory.detail.freshness")}</h3>
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.fields.owner")}</div>
                <div className="font-medium">{draft.owner || "-"}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.fields.lastValidatedAt")}</div>
                <div className="font-medium">{draft.lastValidatedAt || "-"}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.fields.validUntil")}</div>
                <div className="font-medium">{draft.validUntil || "-"}</div>
              </div>
            </div>
          </Card>

          {typedItems.length > 0 && (
            <Card className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-3">{t("memory.detail.typed")}</h3>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                {typedItems.map((item) => (
                  <div key={item.label}>
                    <div className={isDark ? "text-gray-400" : "text-gray-600"}>{item.label}</div>
                    <div className="font-medium">{item.value || "-"}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmArchiveOpen}
        title={t("memory.detail.archiveConfirmTitle")}
        message={t("memory.detail.archiveConfirmMessage")}
        confirmLabel={t("memory.list.archive")}
        cancelLabel={t("memory.list.cancel")}
        variant="warning"
        loading={saving}
        onConfirm={() => void archiveEntry()}
        onCancel={() => {
          if (!saving) setConfirmArchiveOpen(false);
        }}
      />

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
          if (!saving) setConfirmDeleteOpen(false);
        }}
      />
    </PageShell>
  );
};
