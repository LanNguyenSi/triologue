import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, Input, Select } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";

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

export const SecretCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;

  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const res = await api("/api/projects?limit=100");
        if (!res.ok) return;
        const data = await res.json();
        const payload: ProjectListResponse = Array.isArray(data)
          ? { items: data, totalCount: data.length, pageInfo: { limit: 100, hasMore: false, nextCursor: null } }
          : data;
        setProjects(payload.items || []);
      } catch {
        // Best effort
      }
    };

    void loadProjects();
  }, []);

  const createSecret = async () => {
    if (!name.trim() || !value.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await api("/api/secrets", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          value: value,
          description: description.trim() || undefined,
          projectId: projectId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || t("secrets.error.create")));
      }
      toast.success(t("secrets.create.success"));
      navigate(data?.id ? `/secrets/${data.id}` : "/secrets");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("secrets.error.create");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={t("secrets.create.action")}
      subtitle={t("secrets.create.subtitle")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => navigate("/secrets")} disabled={saving}>
            {t("secrets.cancel")}
          </Button>
          <Button type="button" onClick={() => void createSecret()} disabled={saving || !name.trim() || !value.trim()}>
            {saving ? t("common.loading") : t("secrets.create.action")}
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

        <Card className="p-4 sm:p-5">
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t("secrets.field.name")} <span className="text-red-400">*</span></label>
              <Input
                type="text"
                placeholder={t("secrets.name.placeholder")}
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                className="font-mono"
                autoFocus
                required
              />
            </div>
            <div>
              <label className={labelCls}>{t("secrets.field.value")} <span className="text-red-400">*</span></label>
              <Input
                type="password"
                placeholder={t("secrets.value.placeholder")}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
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
              <Select 
                value={projectId} 
                onChange={(value) => setProjectId(value)}
                placeholder={t("secrets.noProject")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
              />
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
};
