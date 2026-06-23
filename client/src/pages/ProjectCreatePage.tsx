import React, { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, Input } from "../components/ui/primitives";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { useChatStore } from "../stores/chatStore";
import { useNotificationStore } from "../stores/notificationStore";
import { apiClient } from "../lib/apiClient";

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export const ProjectCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const refreshRooms = useChatStore((state) => state.loadRooms);
  const addNotification = useNotificationStore((state) => state.add);
  const isDark = theme === "dark";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextStepItems = [
    t("projects.create.step.team"),
    t("projects.create.step.tasks"),
    t("projects.create.step.workflow"),
    t("projects.create.step.secrets"),
  ];

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark ? "border-gray-600/50 bg-gray-700 text-white placeholder-gray-400" : "border-gray-300/60 bg-white"
  } outline-none focus:ring-2 focus:ring-blue-500`;
  const labelCls = `mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-300" : "text-gray-700"}`;
  const hintCls = `mt-1 text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`;
  const chipCls = `inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
    isDark ? "bg-gray-800 text-gray-200 border border-gray-700/50" : "bg-gray-100 text-gray-700 border border-gray-200/60"
  }`;

  const createProject = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || "Create failed"));
      }

      if (data?.roomId) {
        const text = t("projects.notice.roomCreatedFromProject").replace("{roomId}", data.roomId);
        toast.success(text);
        addNotification({
          type: "success",
          title: t("notifications.projectCreatedTitle"),
          message: text,
          link: data.id ? `/projects/${data.id}` : "/projects",
        });
      }

      await refreshRooms();
      navigate(data?.id ? `/projects/${data.id}` : "/projects");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("projects.create.failed");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createProject();
  };

  return (
    <PageShell
      maxWidth="3xl"
      title={t("projects.create.modalTitle")}
      subtitle={t("projects.create.modalHint")}
      actions={
        <>
          <Button size="sm" type="button" variant="secondary" onClick={() => navigate("/projects")} disabled={saving}>
            {t("projects.cancel")}
          </Button>
          <Button size="sm" type="submit" form="project-create-form" disabled={saving || !name.trim()}>
            {saving ? t("projects.creating") : t("projects.create.action")}
          </Button>
        </>
      }
    >
      <form id="project-create-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
            {error}
          </div>
        )}

        <Card tone="accent" className="p-4 sm:p-5">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide">{t("projects.create.nextSteps")}</h2>
            <p className={`text-sm ${isDark ? "text-blue-200" : "text-blue-800"}`}>{t("projects.create.stepHint")}</p>
            <p className={`text-xs ${isDark ? "text-blue-300" : "text-blue-700"}`}>{t("projects.create.roomAutoHint")}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {nextStepItems.map((item) => (
                <span key={item} className={chipCls}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>{t("projects.list.name")} <span className="text-red-400">*</span></label>
              <Input
                type="text"
                placeholder={t("projects.name.placeholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
              <p className={hintCls}>{t("projects.create.nameHint")}</p>
            </div>
            <div>
              <label className={labelCls}>{t("projects.create.descriptionLabel")}</label>
              <textarea
                placeholder={t("projects.description.placeholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={textAreaCls}
                rows={5}
              />
              <p className={hintCls}>{t("projects.create.descriptionHint")}</p>
            </div>
          </div>
        </Card>
      </form>
    </PageShell>
  );
};
