import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ExclamationTriangleIcon,
  PencilSquareIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { useTheme } from "../contexts/ThemeContext";
import { useAuthStore } from "../stores/authStore";
import { PageShell } from "../components/ui/PageShell";
import { Button, Card, EmptyState, Select } from "../components/ui/primitives";
import { fetchProjectActivity, AuditEntry } from "../services/auditApi";

const ACTION_LABELS: Record<string, string> = {
  "message.send": "Nachricht gesendet",
  "attachment.read": "Attachment gelesen",
  "attachment.upload": "Attachment hochgeladen",
  "context.fetch": "Context abgerufen",
  "task.claim": "Task übernommen",
  "task.update": "Task aktualisiert",
  "task.review_requested": "Review angefragt",
  "task.completed": "Task abgeschlossen",
};

export const ProjectActivityPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { token } = useAuthStore();
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
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ""}/api/projects/${projectId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
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
      const params: any = { limit, offset };
      if (filterAction) params.action = filterAction;
      if (filterErrorOnly) params.success = "false";

      const data = await fetchProjectActivity(projectId, params, token);

      if (reset) {
        setEntries(data.items);
      } else {
        setEntries((prev) => [...prev, ...data.items]);
      }
      setTotalCount(data.totalCount);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Fehler beim Laden der Aktivität");
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

    if (diffMins < 1) return "gerade eben";
    if (diffMins < 60) return `vor ${diffMins} Min`;
    if (diffHours < 24) return `vor ${diffHours} Std`;
    if (diffDays === 1) return "gestern";
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    return date.toLocaleDateString();
  };

  const getActionLabel = (action: string) => {
    return ACTION_LABELS[action] || action;
  };

  if (loading && entries.length === 0) {
    return (
      <PageShell maxWidth="4xl">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      maxWidth="4xl"
      title={`${project ? project.name : "Projekt"} - Aktivität`}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          Zurück zum Projekt
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
                  { value: "", label: "Alle Aktionen" },
                  ...Object.entries(ACTION_LABELS).map(([key, label]) => ({
                    value: key,
                    label,
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
                Nur Fehler anzeigen
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
                Erneut versuchen
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<PencilSquareIcon className="w-8 h-8" />}
            title="Noch keine Aktivität in diesem Projekt"
          />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <Card
                key={entry.id}
                className={`p-4 ${!entry.success ? (isDark ? "border-red-900/50 bg-red-900/10" : "border-red-200 bg-red-50") : ""}`}
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${isDark ? "bg-gray-800" : "bg-gray-100"}`}
                    >
                      <CpuChipIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div
                        className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                      >
                        {entry.agentName ||
                          entry.agentUsername ||
                          entry.agentId}
                      </div>
                      <div
                        className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {getActionLabel(entry.action)}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-xs whitespace-nowrap ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {formatTime(entry.timestamp)}
                  </div>
                </div>

                <div className="mt-3 pl-11">
                  <div
                    className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    <span className="font-medium">{entry.resourceType}</span>
                    {entry.resourceId && (
                      <span className="ml-1 opacity-75">
                        ({entry.resourceId})
                      </span>
                    )}
                  </div>

                  {!entry.success && Boolean(entry.details?.error) && (
                    <div
                      className={`mt-2 text-sm p-2 rounded ${isDark ? "bg-red-900/30 text-red-300" : "bg-red-100 text-red-700"}`}
                    >
                      {String(entry.details.error)}
                    </div>
                  )}

                  {entry.durationMs && (
                    <div
                      className={`mt-1 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      Dauer: {entry.durationMs}ms
                    </div>
                  )}
                </div>
              </Card>
            ))}

            {entries.length < totalCount && (
              <div className="pt-4 flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => loadActivity(false)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Laedt..." : "Mehr laden"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
};
