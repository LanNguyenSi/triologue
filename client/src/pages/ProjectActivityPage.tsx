import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ExclamationTriangleIcon,
  PencilSquareIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { useTheme } from "../contexts/ThemeContext";
import { useAuthStore } from "../stores/authStore";
import { useLanguage } from "../contexts/LanguageContext";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, EmptyState, Select } from "../components/ui/primitives";
import { fetchProjectActivity, AuditEntry } from "../services/auditApi";
import { apiClient } from "../lib/apiClient";
import { LoadingSpinner } from "../components/ui";

const ACTION_I18N_KEYS: Record<string, string> = {
  "message.send": "projectActivity.action.messageSend",
  "attachment.read": "projectActivity.action.attachmentRead",
  "attachment.upload": "projectActivity.action.attachmentUpload",
  "context.fetch": "projectActivity.action.contextFetch",
  "task.claim": "projectActivity.action.taskClaim",
  "task.update": "projectActivity.action.taskUpdate",
  "task.review_requested": "projectActivity.action.taskReviewRequested",
  "task.completed": "projectActivity.action.taskCompleted",
};

export const ProjectActivityPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { token } = useAuthStore();
  const { t } = useLanguage();
  const isDark = theme === "dark";

  const [project, setProject] = useState<{ name: string } | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [filterAction, setFilterAction] = useState<string>("");
  const [filterErrorOnly, setFilterErrorOnly] = useState<boolean>(false);

  const limit = 50;

  useEffect(() => {
    if (projectId && token) {
      loadProject();
      loadActivity(true);
    }
  }, [projectId, token, filterAction, filterErrorOnly]);

  const loadProject = async () => {
    if (!projectId || !token) return;
    try {
      const res = await apiClient(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
      }
    } catch (err) {
      console.error("Failed to load project", err);
    }
  };

  const loadActivity = async (reset = false) => {
    if (!projectId || !token) return;

    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const offset = reset ? 0 : entries.length;
      const params: { limit: number; offset: number; action?: string; success?: string } = { limit, offset };
      if (filterAction) params.action = filterAction;
      if (filterErrorOnly) params.success = "false";

      const data = await fetchProjectActivity(projectId, params);

      if (reset) {
        setEntries(data.items);
      } else {
        setEntries((prev) => [...prev, ...data.items]);
      }
      setTotalCount(data.totalCount);
      setError("");
    } catch (err) {
      console.error(err);
      setError(t("projectActivity.error.loadActivity"));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("projectActivity.time.justNow");
    if (diffMins < 60) return t("projectActivity.time.minutesAgo").replace("{count}", String(diffMins));
    if (diffHours < 24) return t("projectActivity.time.hoursAgo").replace("{count}", String(diffHours));
    if (diffDays === 1) return t("projectActivity.time.yesterday");
    if (diffDays < 7) return t("projectActivity.time.daysAgo").replace("{count}", String(diffDays));
    return date.toLocaleDateString();
  };

  const getActionLabel = (action: string) => {
    const key = ACTION_I18N_KEYS[action];
    return key ? t(key) : action;
  };

  if (loading && entries.length === 0) {
    return (
      <PageShell maxWidth="4xl">
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      maxWidth="4xl"
      title={t("projectActivity.pageTitle").replace("{name}", project ? project.name : t("projectActivity.pageDefaultProject"))}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          {t("projectActivity.button.back")}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <Select
                value={filterAction}
                onChange={(value) => setFilterAction(value)}
                options={[
                  { value: "", label: t("projectActivity.filter.allActions") },
                  ...Object.entries(ACTION_I18N_KEYS).map(([key, i18nKey]) => ({
                    value: key,
                    label: t(i18nKey),
                  })),
                ]}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterErrorOnly}
                onChange={(e) => setFilterErrorOnly(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span
                className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("projectActivity.filter.errorsOnly")}
              </span>
            </label>
          </div>
        </Card>

        {error ? (
          <EmptyState
            icon={<ExclamationTriangleIcon className="w-8 h-8" />}
            title={error}
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => loadActivity(true)}
              >
                {t("projectActivity.button.retry")}
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<PencilSquareIcon className="w-8 h-8" />}
            title={t("projectActivity.empty.title")}
          />
        ) : (
          <div>
            <div className={`border-l ml-2 divide-y ${isDark ? "border-gray-700/60 divide-gray-700/40" : "border-gray-200/70 divide-gray-100"}`}>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex gap-3 items-start py-1.5 pl-3 ${!entry.success ? (isDark ? "bg-red-900/10" : "bg-red-50/50") : ""}`}
                >
                  <div className={`mt-0.5 flex-shrink-0 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    <CpuChipIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div
                        className={`font-medium text-sm truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
                      >
                        {entry.agentName || entry.agentUsername || entry.agentId}
                      </div>
                      <div
                        className={`text-xs whitespace-nowrap flex-shrink-0 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                      >
                        {formatTime(entry.timestamp)}
                      </div>
                    </div>
                    <div className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                      {getActionLabel(entry.action)}{" "}
                      <span className="font-medium">{entry.resourceType}</span>
                      {entry.resourceId && (
                        <span className="opacity-75"> ({entry.resourceId})</span>
                      )}
                      {entry.durationMs && (
                        <span className="ml-1 opacity-60">
                          · {t("projectActivity.duration").replace("{ms}", String(entry.durationMs))}
                        </span>
                      )}
                    </div>
                    {!entry.success && Boolean(entry.details?.error) && (
                      <div
                        className={`mt-1 text-xs p-1.5 rounded ${isDark ? "bg-red-900/30 text-red-300" : "bg-red-100 text-red-700"}`}
                      >
                        {String(entry.details.error)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {entries.length < totalCount && (
              <div className="pt-4 flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => loadActivity(false)}
                  disabled={loadingMore}
                >
                  {loadingMore ? t("projectActivity.button.loadingMore") : t("projectActivity.button.loadMore")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
};
