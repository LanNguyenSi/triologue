import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, EmptyState, Input, Select } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";

interface SecretDetail {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface ProjectListResponse {
  items: Project[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem("triologue_token");
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
};

export const SecretEditPage: React.FC = () => {
  const navigate = useNavigate();
  const { secretId = "" } = useParams<{ secretId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;

  const [projects, setProjects] = useState<Project[]>([]);
  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const res = await api("/api/projects?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      const payload: ProjectListResponse = Array.isArray(data)
        ? { items: data, totalCount: data.length, pageInfo: { limit: 100, hasMore: false, nextCursor: null } }
        : data;
      setProjects(payload.items || []);
    } catch {
      // best effort
    }
  }, []);

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
      const current = data as SecretDetail;
      setSecret(current);
      setName(current.name || "");
      setDescription(current.description || "");
      setProjectId(current.projectId || "");
      setValue("");
    } catch (err: any) {
      setError(err?.message || t("secrets.error.load"));
      setSecret(null);
    } finally {
      setLoading(false);
    }
  }, [secretId, t]);

  useEffect(() => {
    void loadProjects();
    void loadSecret();
  }, [loadProjects, loadSecret]);

  const save = async () => {
    if (!secret || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await api(`/api/secrets/${encodeURIComponent(secret.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          value: value || undefined,
          description: description,
          projectId: projectId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || t("secrets.error.update")));
      }
      toast.success(t("secrets.save"));
      navigate(`/secrets/${secret.id}`);
    } catch (err: any) {
      const msg = err?.message || t("secrets.error.update");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🔑 {t("secrets.edit.title")}</span>}
      subtitle={t("secrets.edit.subtitle")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => navigate(secretId ? `/secrets/${secretId}` : "/secrets")} disabled={saving}>
            {t("secrets.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !secret || !name.trim()}>
            {saving ? t("common.loading") : t("secrets.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : !secret ? (
          <EmptyState
            icon="🔑"
            title={t("secrets.detail.notFound")}
            action={
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/secrets")}>
                {t("secrets.detail.back")}
              </Button>
            }
          />
        ) : (
          <Card className="p-4 sm:p-5">
            <div className="grid gap-3">
              <div>
                <label className={labelCls}>{t("secrets.field.name")} <span className="text-red-400">*</span></label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  className="font-mono"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className={labelCls}>{t("secrets.field.newValue")}</label>
                <Input
                  type="password"
                  placeholder={t("secrets.newValue.placeholder")}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>{t("secrets.field.description")}</label>
                <Input
                  type="text"
                  placeholder={t("secrets.description.placeholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>{t("secrets.field.project")}</label>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">{t("secrets.noProject")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
};
