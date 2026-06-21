export interface ProjectBrief {
  goal: string;
  scope: string;
  outOfScope: string;
  successCriteria: string;
}

export interface ProjectRunbook {
  preferredLanguage: string;
  responseStyle: string;
  constraints: string;
  escalationPath: string;
}

export interface DecisionLogEntry {
  id: string;
  date: string;
  title: string;
  decision: string;
  rationale: string;
}

export type MilestoneStatus = "planned" | "in_progress" | "done";

export interface MilestoneEntry {
  id: string;
  title: string;
  dueDate: string;
  status: MilestoneStatus;
  notes: string;
}

export interface ProjectContext {
  definitionOfDone: string[];
  decisionLog: DecisionLogEntry[];
  milestones: MilestoneEntry[];
  brief: ProjectBrief;
  runbook: ProjectRunbook;
}

export interface WorkflowConfig {
  enabledStatuses: string[];
  instructions: Record<string, string>;
}
