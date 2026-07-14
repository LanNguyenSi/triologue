import type { WorkflowConfig, ProjectContext } from "./projectTypes";

export interface TeamMember {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  userType: "HUMAN" | "AI_AGENT" | "AI_ICE" | "AI_LAVA" | "AI_OTHER";
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string;
  roomId?: string | null;
  teamMemberIds: string[];
  teamMembers?: TeamMember[];
  attachments?: ProjectAttachment[];
  workflowConfig?: WorkflowConfig;
  projectContext?: ProjectContext;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  size?: number | null;
  type?: string | null;
  uploadedBy?: string | null;
  sourcePluginId?: string | null;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  size?: number | null;
  type:
    | "IMAGE"
    | "DOCUMENT"
    | "CODE_SNIPPET"
    | "RESEARCH_DATA"
    | "MEMORY_EXPORT";
  uploadedBy: string;
  createdAt: string;
}

export interface TaskReviewer {
  id: string;
  username: string;
  displayName: string;
  userType: TeamMember["userType"];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  assignedTo: string;
  reviewedBy: string | null;
  reviewer: TaskReviewer | null;
  priority?: string;
  dueDate?: string;
  usedMemoryIds?: string[];
  attachments?: TaskAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPluginEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  workspaceEnabled: boolean;
  userEnabled: boolean;
  enabled: boolean;
  linked: boolean;
  canManage: boolean;
}
