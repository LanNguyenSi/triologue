import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card, EmptyState, Input, SectionHeader, Select } from '../components/ui/primitives';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

interface ProjectBrief {
  goal: string;
  scope: string;
  outOfScope: string;
  successCriteria: string;
}

interface ProjectRunbook {
  preferredLanguage: string;
  responseStyle: string;
  constraints: string;
  escalationPath: string;
}

interface DecisionLogEntry {
  id: string;
  date: string;
  title: string;
  decision: string;
  rationale: string;
}

type MilestoneStatus = 'planned' | 'in_progress' | 'done';

interface MilestoneEntry {
  id: string;
  title: string;
  dueDate: string;
  status: MilestoneStatus;
  notes: string;
}

interface ProjectContext {
  definitionOfDone: string[];
  decisionLog: DecisionLogEntry[];
  milestones: MilestoneEntry[];
  brief: ProjectBrief;
  runbook: ProjectRunbook;
}

interface WorkflowConfig {
  enabledStatuses: string[];
  instructions: Record<string, string>;
}

interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  ownerId: string;
  roomId?: string | null;
  workflowConfig?: WorkflowConfig;
  projectContext?: ProjectContext;
}

const CORE_TASK_STATUSES = ['todo', 'in_progress', 'done'];
const OPTIONAL_TASK_STATUSES = ['blocked', 'in_review'];
const TASK_STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];

const defaultWorkflowConfig = (): WorkflowConfig => ({
  enabledStatuses: [...CORE_TASK_STATUSES],
  instructions: TASK_STATUS_ORDER.reduce<Record<string, string>>((acc, status) => {
    acc[status] = '';
    return acc;
  }, {}),
});

const normalizeWorkflowConfig = (raw?: Partial<WorkflowConfig> | null): WorkflowConfig => {
  const defaults = defaultWorkflowConfig();
  const enabledSet = new Set<string>(CORE_TASK_STATUSES);
  for (const status of raw?.enabledStatuses || []) {
    if (TASK_STATUS_ORDER.includes(status)) enabledSet.add(status);
  }

  const instructions = { ...defaults.instructions };
  if (raw?.instructions) {
    for (const status of TASK_STATUS_ORDER) {
      const value = raw.instructions[status];
      if (typeof value === 'string') instructions[status] = value;
    }
  }

  return {
    enabledStatuses: TASK_STATUS_ORDER.filter((status) => enabledSet.has(status)),
    instructions,
  };
};

const defaultProjectContext = (): ProjectContext => ({
  definitionOfDone: [],
  decisionLog: [],
  milestones: [],
  brief: {
    goal: '',
    scope: '',
    outOfScope: '',
    successCriteria: '',
  },
  runbook: {
    preferredLanguage: '',
    responseStyle: '',
    constraints: '',
    escalationPath: '',
  },
});

const normalizeProjectContext = (raw?: Partial<ProjectContext> | null): ProjectContext => {
  const defaults = defaultProjectContext();
  const definitionOfDone = Array.isArray(raw?.definitionOfDone)
    ? raw.definitionOfDone
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 40)
    : defaults.definitionOfDone;

  const decisionLog = Array.isArray(raw?.decisionLog)
    ? raw.decisionLog
        .map((entry, index): DecisionLogEntry | null => {
          if (!entry || typeof entry !== 'object') return null;
          const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `decision-${index + 1}`;
          const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date.trim())
            ? entry.date.trim()
            : '';
          const title = typeof entry.title === 'string' ? entry.title.trim() : '';
          const decision = typeof entry.decision === 'string' ? entry.decision.trim() : '';
          const rationale = typeof entry.rationale === 'string' ? entry.rationale.trim() : '';
          if (!date && !title && !decision && !rationale) return null;
          return { id, date, title, decision, rationale };
        })
        .filter((entry): entry is DecisionLogEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.decisionLog;

  const milestones = Array.isArray(raw?.milestones)
    ? raw.milestones
        .map((entry, index): MilestoneEntry | null => {
          if (!entry || typeof entry !== 'object') return null;
          const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `milestone-${index + 1}`;
          const title = typeof entry.title === 'string' ? entry.title.trim() : '';
          const dueDate = typeof entry.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate.trim())
            ? entry.dueDate.trim()
            : '';
          const status: MilestoneStatus = entry.status === 'in_progress' || entry.status === 'done' ? entry.status : 'planned';
          const notes = typeof entry.notes === 'string' ? entry.notes.trim() : '';
          if (!title && !dueDate && !notes) return null;
          return { id, title, dueDate, status, notes };
        })
        .filter((entry): entry is MilestoneEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.milestones;

  const brief: Partial<ProjectBrief> =
    raw?.brief && typeof raw.brief === 'object' ? (raw.brief as Partial<ProjectBrief>) : {};
  const runbook: Partial<ProjectRunbook> =
    raw?.runbook && typeof raw.runbook === 'object' ? (raw.runbook as Partial<ProjectRunbook>) : {};

  const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  return {
    definitionOfDone,
    decisionLog,
    milestones,
    brief: {
      goal: normalize(brief.goal) || defaults.brief.goal,
      scope: normalize(brief.scope) || defaults.brief.scope,
      outOfScope: normalize(brief.outOfScope) || defaults.brief.outOfScope,
      successCriteria: normalize(brief.successCriteria) || defaults.brief.successCriteria,
    },
    runbook: {
      preferredLanguage: normalize(runbook.preferredLanguage) || defaults.runbook.preferredLanguage,
      responseStyle: normalize(runbook.responseStyle) || defaults.runbook.responseStyle,
      constraints: normalize(runbook.constraints) || defaults.runbook.constraints,
      escalationPath: normalize(runbook.escalationPath) || defaults.runbook.escalationPath,
    },
  };
};

const generateContextEntryId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem('triologue_token');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((opts?.headers as Record<string, string>) || {}),
  };
  if (!(opts?.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(path, { ...opts, headers });
};

export const ProjectEditPage: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const loadRooms = useChatStore((state) => state.loadRooms);
  const isDark = theme === 'dark';

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectStatus, setProjectStatus] = useState('active');
  const [savingProject, setSavingProject] = useState(false);

  const [workflowEnabledStatuses, setWorkflowEnabledStatuses] = useState<string[]>([...CORE_TASK_STATUSES]);
  const [workflowInstructions, setWorkflowInstructions] = useState<Record<string, string>>(defaultWorkflowConfig().instructions);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const [projectContextDraft, setProjectContextDraft] = useState<ProjectContext>(defaultProjectContext());
  const [savingProjectContext, setSavingProjectContext] = useState(false);

  const isOwner = Boolean(project && user && project.ownerId === user.id);

  const draftWorkflowStatuses = useMemo(
    () => TASK_STATUS_ORDER.filter(
      (status) => CORE_TASK_STATUSES.includes(status) || workflowEnabledStatuses.includes(status),
    ),
    [workflowEnabledStatuses],
  );

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  } outline-none focus:ring-2 focus:ring-blue-500`;

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');

    try {
      const response = await api(`/api/projects/${projectId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || t('projects.detail.loadError')));
      }

      const normalizedWorkflow = normalizeWorkflowConfig(data.workflowConfig);
      const normalizedContext = normalizeProjectContext(data.projectContext);
      setProject({
        ...data,
        workflowConfig: normalizedWorkflow,
        projectContext: normalizedContext,
      });
      setProjectName(String(data?.name || ''));
      setProjectDescription(String(data?.description || ''));
      setProjectStatus(String(data?.status || 'active'));
      setWorkflowEnabledStatuses(normalizedWorkflow.enabledStatuses);
      setWorkflowInstructions({ ...normalizedWorkflow.instructions });
      setProjectContextDraft(normalizedContext);
    } catch (err: any) {
      setProject(null);
      setError(err?.message || t('projects.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const saveProjectBasics = async () => {
    if (!project || !projectId || !projectName.trim()) return;

    setSavingProject(true);
    try {
      const response = await api(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim() || null,
          status: projectStatus,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || t('projects.update.failed')));
      }

      const shouldRefreshRooms =
        Boolean(project.roomId) && (project.status !== data.status || project.name !== data.name);

      setProject((prev) => (prev ? { ...prev, ...data } : prev));
      if (shouldRefreshRooms) {
        await loadRooms();
      }
      toast.success(t('projects.update.save'));
    } catch (err: any) {
      toast.error(err?.message || t('projects.update.failed'));
    } finally {
      setSavingProject(false);
    }
  };

  const saveWorkflow = async () => {
    if (!project || !projectId) return;

    const enabledStatuses = [
      ...CORE_TASK_STATUSES,
      ...OPTIONAL_TASK_STATUSES.filter((status) => workflowEnabledStatuses.includes(status)),
    ];

    setSavingWorkflow(true);
    try {
      const response = await api(`/api/projects/${projectId}/workflow`, {
        method: 'PUT',
        body: JSON.stringify({
          enabledStatuses,
          instructions: workflowInstructions,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || t('projects.workflow.saveFailed')));
      }

      const normalized = normalizeWorkflowConfig(data.workflowConfig);
      setProject((prev) => (prev ? { ...prev, workflowConfig: normalized } : prev));
      setWorkflowEnabledStatuses(normalized.enabledStatuses);
      setWorkflowInstructions({ ...normalized.instructions });
      toast.success(t('projects.workflow.saved'));
    } catch (err: any) {
      toast.error(err?.message || t('projects.workflow.saveFailed'));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const saveProjectContext = async () => {
    if (!project || !projectId) return;

    setSavingProjectContext(true);
    try {
      const response = await api(`/api/projects/${projectId}/context`, {
        method: 'PUT',
        body: JSON.stringify(projectContextDraft),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || t('projects.context.saveFailed')));
      }

      const normalized = normalizeProjectContext(data.projectContext);
      setProject((prev) => (prev ? { ...prev, projectContext: normalized } : prev));
      setProjectContextDraft(normalized);
      toast.success(t('projects.context.saved'));
    } catch (err: any) {
      toast.error(err?.message || t('projects.context.saveFailed'));
    } finally {
      setSavingProjectContext(false);
    }
  };

  const addDefinitionOfDoneItem = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: [...prev.definitionOfDone, ''],
    }));
  };

  const updateDefinitionOfDoneItem = (index: number, value: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: prev.definitionOfDone.map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  };

  const removeDefinitionOfDoneItem = (index: number) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: prev.definitionOfDone.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const addDecisionLogEntry = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: [
        ...prev.decisionLog,
        { id: generateContextEntryId('decision'), date: '', title: '', decision: '', rationale: '' },
      ],
    }));
  };

  const updateDecisionLogEntry = (entryId: string, patch: Partial<DecisionLogEntry>) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: prev.decisionLog.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  };

  const removeDecisionLogEntry = (entryId: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: prev.decisionLog.filter((entry) => entry.id !== entryId),
    }));
  };

  const addMilestoneEntry = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: [
        ...prev.milestones,
        { id: generateContextEntryId('milestone'), title: '', dueDate: '', status: 'planned', notes: '' },
      ],
    }));
  };

  const updateMilestoneEntry = (entryId: string, patch: Partial<MilestoneEntry>) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: prev.milestones.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  };

  const removeMilestoneEntry = (entryId: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((entry) => entry.id !== entryId),
    }));
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">📋 {t('projects.edit.title')}</span>}
      subtitle={project ? `${project.name} · ${t('projects.edit.subtitle')}` : t('projects.edit.subtitle')}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => navigate(projectId ? `/projects/${projectId}` : '/projects')}>
            {t('projects.edit.back')}
          </Button>
          {projectId && (
            <Button type="button" onClick={() => navigate(`/projects/${projectId}`)}>
              {t('projects.actions.details')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div className={`mb-4 rounded p-3 text-sm ${isDark ? 'bg-red-900/50 text-red-200' : 'bg-red-50 text-red-700'}`}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : !project ? (
        <EmptyState
          icon="📋"
          title={t('projects.detail.notFound')}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/projects')}>
              {t('projects.detail.backToList')}
            </Button>
          }
        />
      ) : !isOwner ? (
        <EmptyState
          icon="🔒"
          title={t('projects.edit.ownerOnly')}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/projects/${project.id}`)}>
              {t('projects.actions.details')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <Card className="p-4 sm:p-5 space-y-4">
            <SectionHeader title={t('projects.actions.edit')} className="mb-0" />
            <div className="grid gap-3">
              <div>
                <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.list.name')}
                </label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={t('projects.name.placeholder')}
                />
              </div>
              <div>
                <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.description')}
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  rows={3}
                  placeholder={t('projects.description.placeholder')}
                  className={textAreaCls}
                />
              </div>
              <div>
                <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.detail.status')}
                </label>
                <Select value={projectStatus} onChange={(e) => setProjectStatus(e.target.value)}>
                  <option value="active">{t('projects.status.active')}</option>
                  <option value="archived">{t('projects.status.archived')}</option>
                  <option value="closed">{t('projects.status.closed')}</option>
                </Select>
              </div>
            </div>
            <div>
              <Button type="button" onClick={() => void saveProjectBasics()} disabled={savingProject || !projectName.trim()}>
                {savingProject ? t('projects.update.saving') : t('projects.update.save')}
              </Button>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <SectionHeader title={t('projects.workflow.title')} />
            <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{t('projects.workflow.description')}</p>

            <div>
              <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('projects.workflow.optionalStatuses')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OPTIONAL_TASK_STATUSES.map((status) => {
                  const checked = workflowEnabledStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${isDark ? 'border-gray-700 bg-gray-800/70 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setWorkflowEnabledStatuses((prev) => {
                            if (isChecked) return [...new Set([...prev, status])];
                            return prev.filter((item) => item !== status);
                          });
                        }}
                      />
                      {t(`projects.status.${status}`)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('projects.workflow.instructions')}
              </div>
              {draftWorkflowStatuses.map((status) => (
                <div key={status}>
                  <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t(`projects.status.${status}`)}
                  </label>
                  <textarea
                    rows={2}
                    value={workflowInstructions[status] || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setWorkflowInstructions((prev) => ({ ...prev, [status]: value }));
                    }}
                    placeholder={t('projects.workflow.instructionsPlaceholder')}
                    className={textAreaCls}
                  />
                </div>
              ))}
            </div>

            <div>
              <Button type="button" onClick={() => void saveWorkflow()} disabled={savingWorkflow}>
                {savingWorkflow ? t('projects.workflow.saving') : t('projects.workflow.save')}
              </Button>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <SectionHeader title={t('projects.context.title')} actions={<Badge variant="neutral">{projectContextDraft.definitionOfDone.length}</Badge>} />
            <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{t('projects.context.description')}</p>

            <div className="space-y-4">
              <div>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.context.dod.title')}
                </div>
                <div className="space-y-2">
                  {projectContextDraft.definitionOfDone.map((item, index) => (
                    <div key={`dod-${index}`} className="flex flex-col sm:flex-row gap-2">
                      <textarea
                        rows={2}
                        value={item}
                        onChange={(e) => updateDefinitionOfDoneItem(index, e.target.value)}
                        placeholder={t('projects.context.dod.placeholder')}
                        className={textAreaCls}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        className="w-full sm:w-auto shrink-0 sm:self-start"
                        onClick={() => removeDefinitionOfDoneItem(index)}
                      >
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addDefinitionOfDoneItem}>
                    {t('projects.context.dod.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.context.decision.title')}
                </div>
                <div className="space-y-3">
                  {projectContextDraft.decisionLog.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded border p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.decision.date')}
                          </label>
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) => updateDecisionLogEntry(entry.id, { date: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.decision.entryTitle')}
                          </label>
                          <Input
                            type="text"
                            value={entry.title}
                            onChange={(e) => updateDecisionLogEntry(entry.id, { title: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.decision.decision')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.decision}
                          onChange={(e) => updateDecisionLogEntry(entry.id, { decision: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <div>
                        <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.decision.rationale')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.rationale}
                          onChange={(e) => updateDecisionLogEntry(entry.id, { rationale: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <Button type="button" size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => removeDecisionLogEntry(entry.id)}>
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addDecisionLogEntry}>
                    {t('projects.context.decision.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.context.milestones.title')}
                </div>
                <div className="space-y-3">
                  {projectContextDraft.milestones.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded border p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.milestones.name')}
                          </label>
                          <Input
                            type="text"
                            value={entry.title}
                            onChange={(e) => updateMilestoneEntry(entry.id, { title: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.milestones.deadline')}
                          </label>
                          <Input
                            type="date"
                            value={entry.dueDate}
                            onChange={(e) => updateMilestoneEntry(entry.id, { dueDate: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.milestones.status')}
                        </label>
                        <Select
                          value={entry.status}
                          onChange={(e) => updateMilestoneEntry(entry.id, { status: e.target.value as MilestoneStatus })}
                        >
                          <option value="planned">{t('projects.context.milestones.status.planned')}</option>
                          <option value="in_progress">{t('projects.context.milestones.status.in_progress')}</option>
                          <option value="done">{t('projects.context.milestones.status.done')}</option>
                        </Select>
                      </div>
                      <div>
                        <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.milestones.notes')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.notes}
                          onChange={(e) => updateMilestoneEntry(entry.id, { notes: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <Button type="button" size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => removeMilestoneEntry(entry.id)}>
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addMilestoneEntry}>
                    {t('projects.context.milestones.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.context.brief.title')}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.goal')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.goal}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, goal: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.scope')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.scope}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, scope: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.outOfScope')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.outOfScope}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, outOfScope: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.successCriteria')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.successCriteria}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, successCriteria: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('projects.context.runbook.title')}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.preferredLanguage')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.preferredLanguage}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, preferredLanguage: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.responseStyle')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.responseStyle}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, responseStyle: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.constraints')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.constraints}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, constraints: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.escalationPath')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.escalationPath}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, escalationPath: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Button type="button" onClick={() => void saveProjectContext()} disabled={savingProjectContext}>
                {savingProjectContext ? t('projects.context.saving') : t('projects.context.save')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
};
