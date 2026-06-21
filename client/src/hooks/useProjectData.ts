import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../lib/apiClient";
import { useLanguage } from "../contexts/LanguageContext";
import { normalizeWorkflowConfig, normalizeProjectContext } from "../projects/projectNormalize";
import type { Project, Task } from "../projects/projectDomainTypes";

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export function useProjectData(projectId: string | undefined) {
  const { t } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject({
          ...data,
          workflowConfig: normalizeWorkflowConfig(data.workflowConfig),
          projectContext: normalizeProjectContext(data.projectContext),
        });
        setTasks(data.tasks || []);
        setError("");
      } else {
        setError(t("projects.detail.notFound"));
      }
    } catch (err) {
      setError(t("projects.detail.loadError"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    if (projectId) void loadProject();
  }, [projectId, loadProject]);

  return { project, setProject, tasks, setTasks, loading, error, loadProject };
}
