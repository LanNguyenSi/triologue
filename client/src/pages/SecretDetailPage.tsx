import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { KeyIcon, FolderIcon } from "@heroicons/react/24/outline";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import { Badge, Button, Card, EmptyState } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { apiClient } from "../lib/apiClient";

interface SecretDetail {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  lastUsedAt: string | null;
  lastUsedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export const SecretDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { secretId = "" } = useParams<{ secretId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadSecret = useCallback(async () => {
    if (!secretId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api(`/api/secrets/${encodeURIComponent(secretId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || `Load failed (${res.status})`));
      }
      setSecret(data as SecretDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("secrets.error.load"));
      setSecret(null);
    } finally {
      setLoading(false);
    }
  }, [secretId, t]);

  useEffect(() => {
    void loadSecret();
  }, [loadSecret]);

  const handleDelete = async () => {
    if (!secret) return;
    setDeleting(true);
    setError("");
    try {
      const res = await api(`/api/secrets/${encodeURIComponent(secret.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(String(data?.error || t("secrets.error.delete")));
      }
      toast.success(t("secrets.delete"));
      navigate("/secrets");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("secrets.error.delete");
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
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

  const handleExportMetadata = () => {
    if (!secret || exporting) return;
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const stamp = exportedAt.replace(/[:.]/g, "-");
      downloadJson(
        {
          exportedAt,
          kind: "secret-metadata",
          item: secret,
        },
        `secret-metadata-${secret.id}-${stamp}.json`,
      );
    } catch (err) {
      console.error(err);
      toast.error(t("secrets.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={t("secrets.detail.title")}
      subtitle={t("secrets.detail.subtitle")}
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" className="h-8 px-3 whitespace-nowrap" onClick={() => navigate("/secrets")}>
            {t("secrets.detail.back")}
          </Button>
          {secret && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                onClick={() => void handleExportMetadata()}
                disabled={exporting}
              >
                {exporting ? t("secrets.actions.exporting") : t("secrets.actions.exportMetadata")}
              </Button>
              <Button type="button" size="sm" className="h-8 min-w-[92px] justify-center whitespace-nowrap" onClick={() => navigate(`/secrets/${secret.id}/edit`)}>
                {t("secrets.edit")}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={deleting}
              >
                {t("secrets.delete")}
              </Button>
            </>
          )}
        </>
      }
    >
      {error && (
        <div className={`mb-4 rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : !secret ? (
        <EmptyState
          icon={<KeyIcon className="w-8 h-8" />}
          title={t("secrets.detail.notFound")}
          action={
            <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/secrets")}>
              {t("secrets.detail.back")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-semibold break-words">{secret.name}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {secret.projectName ? (
                    <Badge variant="neutral"><FolderIcon className="w-3 h-3 inline -mt-0.5" /> {secret.projectName}</Badge>
                  ) : (
                    <Badge variant="neutral">{t("secrets.noProject")}</Badge>
                  )}
                </div>
              </div>
            </div>
            {secret.description && (
              <p className={`mt-3 text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{secret.description}</p>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-3">{t("secrets.detail.meta")}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("secrets.list.name")}</div>
                <div className="font-medium font-mono">{secret.name}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("secrets.list.project")}</div>
                <div className="font-medium">{secret.projectName || t("secrets.noProject")}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("secrets.list.created")}</div>
                <div className="font-medium">{new Date(secret.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("memory.list.updatedAt")}</div>
                <div className="font-medium">{new Date(secret.updatedAt).toLocaleString()}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("secrets.lastUsedBy")}</div>
                <div className="font-medium">{secret.lastUsedBy || t("secrets.lastUsed.never")}</div>
              </div>
              <div>
                <div className={isDark ? "text-gray-400" : "text-gray-600"}>{t("secrets.list.lastUsed")}</div>
                <div className="font-medium">{secret.lastUsedAt ? new Date(secret.lastUsedAt).toLocaleString() : t("secrets.lastUsed.never")}</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("secrets.delete.title")}
        message={t("secrets.delete.message")}
        confirmLabel={t("secrets.delete")}
        cancelLabel={t("secrets.cancel")}
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
      />
    </PageShell>
  );
};
