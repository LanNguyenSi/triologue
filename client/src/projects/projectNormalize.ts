import type {
  DecisionLogEntry,
  MilestoneEntry,
  MilestoneStatus,
  ProjectBrief,
  ProjectContext,
  ProjectRunbook,
  WorkflowConfig,
} from "./projectTypes";

export const CORE_TASK_STATUSES = ["todo", "in_progress", "done"];
export const TASK_STATUS_ORDER = [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
];

export const defaultWorkflowConfig = (): WorkflowConfig => ({
  enabledStatuses: [...CORE_TASK_STATUSES],
  instructions: TASK_STATUS_ORDER.reduce<Record<string, string>>(
    (acc, status) => {
      acc[status] = "";
      return acc;
    },
    {},
  ),
});

export const normalizeWorkflowConfig = (
  raw?: Partial<WorkflowConfig> | null,
): WorkflowConfig => {
  const defaults = defaultWorkflowConfig();
  const enabledSet = new Set<string>(CORE_TASK_STATUSES);
  for (const status of raw?.enabledStatuses || []) {
    if (TASK_STATUS_ORDER.includes(status)) {
      enabledSet.add(status);
    }
  }

  const instructions = { ...defaults.instructions };
  if (raw?.instructions) {
    for (const status of TASK_STATUS_ORDER) {
      const value = raw.instructions[status];
      if (typeof value === "string") instructions[status] = value;
    }
  }

  return {
    enabledStatuses: TASK_STATUS_ORDER.filter((status) =>
      enabledSet.has(status),
    ),
    instructions,
  };
};

export const defaultProjectContext = (): ProjectContext => ({
  definitionOfDone: [],
  decisionLog: [],
  milestones: [],
  brief: {
    goal: "",
    scope: "",
    outOfScope: "",
    successCriteria: "",
  },
  runbook: {
    preferredLanguage: "",
    responseStyle: "",
    constraints: "",
    escalationPath: "",
  },
});

export const normalizeProjectContext = (
  raw?: Partial<ProjectContext> | null,
): ProjectContext => {
  const defaults = defaultProjectContext();
  const definitionOfDone = Array.isArray(raw?.definitionOfDone)
    ? raw.definitionOfDone
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 40)
    : defaults.definitionOfDone;
  const decisionLog = Array.isArray(raw?.decisionLog)
    ? raw.decisionLog
        .map((entry, index): DecisionLogEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const id =
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id.trim()
              : `decision-${index + 1}`;
          const date =
            typeof entry.date === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.date.trim())
              ? entry.date.trim()
              : "";
          const title =
            typeof entry.title === "string" ? entry.title.trim() : "";
          const decision =
            typeof entry.decision === "string" ? entry.decision.trim() : "";
          const rationale =
            typeof entry.rationale === "string" ? entry.rationale.trim() : "";
          if (!date && !title && !decision && !rationale) return null;
          return { id, date, title, decision, rationale };
        })
        .filter((entry): entry is DecisionLogEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.decisionLog;
  const milestones = Array.isArray(raw?.milestones)
    ? raw.milestones
        .map((entry, index): MilestoneEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const id =
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id.trim()
              : `milestone-${index + 1}`;
          const title =
            typeof entry.title === "string" ? entry.title.trim() : "";
          const dueDate =
            typeof entry.dueDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate.trim())
              ? entry.dueDate.trim()
              : "";
          const status: MilestoneStatus =
            entry.status === "in_progress" || entry.status === "done"
              ? entry.status
              : "planned";
          const notes =
            typeof entry.notes === "string" ? entry.notes.trim() : "";
          if (!title && !dueDate && !notes) return null;
          return { id, title, dueDate, status, notes };
        })
        .filter((entry): entry is MilestoneEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.milestones;
  const brief: Partial<ProjectBrief> =
    raw?.brief && typeof raw.brief === "object"
      ? (raw.brief as Partial<ProjectBrief>)
      : {};
  const runbook: Partial<ProjectRunbook> =
    raw?.runbook && typeof raw.runbook === "object"
      ? (raw.runbook as Partial<ProjectRunbook>)
      : {};

  const normalize = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";

  return {
    definitionOfDone,
    decisionLog,
    milestones,
    brief: {
      goal: normalize(brief.goal) || defaults.brief.goal,
      scope: normalize(brief.scope) || defaults.brief.scope,
      outOfScope: normalize(brief.outOfScope) || defaults.brief.outOfScope,
      successCriteria:
        normalize(brief.successCriteria) || defaults.brief.successCriteria,
    },
    runbook: {
      preferredLanguage:
        normalize(runbook.preferredLanguage) ||
        defaults.runbook.preferredLanguage,
      responseStyle:
        normalize(runbook.responseStyle) || defaults.runbook.responseStyle,
      constraints:
        normalize(runbook.constraints) || defaults.runbook.constraints,
      escalationPath:
        normalize(runbook.escalationPath) || defaults.runbook.escalationPath,
    },
  };
};
