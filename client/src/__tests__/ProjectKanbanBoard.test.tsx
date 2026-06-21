// @vitest-environment jsdom
/**
 * Smoke tests for ProjectKanbanBoard.
 *
 * Verifies:
 *   - Tasks are grouped into their status columns.
 *   - Clicking the Edit affordance on a task card calls onEditTask.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { ProjectKanbanBoard } from "../components/projects/ProjectKanbanBoard";
import type { Task, TeamMember } from "../projects/projectDomainTypes";
import type { WorkflowConfig } from "../projects/projectTypes";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeWorkflowConfig = (
  statuses: string[] = ["todo", "in_progress", "done"],
): WorkflowConfig => ({
  enabledStatuses: statuses,
  instructions: {},
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  projectId: "proj-1",
  title: "Fix the bug",
  description: "",
  status: "todo",
  assignedTo: "user-1",
  reviewedBy: null,
  reviewer: null,
  priority: "medium",
  usedMemoryIds: [],
  attachments: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const teamMember: TeamMember = {
  id: "user-1",
  username: "alice",
  displayName: "Alice",
  userType: "HUMAN",
};

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// 1. Tasks appear in their respective status columns
// ---------------------------------------------------------------------------
describe("ProjectKanbanBoard task grouping", () => {
  it("renders a task card in the matching status column", () => {
    const tasks = [makeTask({ status: "todo", title: "My todo task" })];
    const lookup = new Map([[teamMember.id, teamMember]]);

    render(
      <ProjectKanbanBoard
        statuses={["todo", "in_progress", "done"]}
        workflowConfig={makeWorkflowConfig()}
        tasks={tasks}
        teamMemberLookup={lookup}
        user={{ id: "user-1" }}
        isOwner={false}
        isDark={false}
        onStatusChange={vi.fn()}
        onEditTask={vi.fn()}
        onTaskAttachments={vi.fn()}
      />,
    );

    expect(screen.getByText("My todo task")).toBeTruthy();
  });

  it("renders tasks for multiple columns", () => {
    const tasks = [
      makeTask({ id: "t1", status: "todo", title: "Task in todo" }),
      makeTask({ id: "t2", status: "in_progress", title: "Task in progress" }),
    ];
    const lookup = new Map([[teamMember.id, teamMember]]);

    render(
      <ProjectKanbanBoard
        statuses={["todo", "in_progress", "done"]}
        workflowConfig={makeWorkflowConfig()}
        tasks={tasks}
        teamMemberLookup={lookup}
        user={{ id: "user-1" }}
        isOwner={false}
        isDark={false}
        onStatusChange={vi.fn()}
        onEditTask={vi.fn()}
        onTaskAttachments={vi.fn()}
      />,
    );

    expect(screen.getByText("Task in todo")).toBeTruthy();
    expect(screen.getByText("Task in progress")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Clicking the Edit affordance on a card calls onEditTask
// ---------------------------------------------------------------------------
describe("ProjectKanbanBoard edit affordance", () => {
  it("calls onEditTask with the task when Edit is clicked by the owner", () => {
    const onEditTask = vi.fn();
    const task = makeTask({ status: "todo", title: "Editable task" });
    const lookup = new Map([[teamMember.id, teamMember]]);

    render(
      <ProjectKanbanBoard
        statuses={["todo"]}
        workflowConfig={makeWorkflowConfig(["todo"])}
        tasks={[task]}
        teamMemberLookup={lookup}
        // isOwner=true means canEditTask is always true regardless of assignee.
        user={{ id: "user-99" }}
        isOwner
        isDark={false}
        onStatusChange={vi.fn()}
        onEditTask={onEditTask}
        onTaskAttachments={vi.fn()}
      />,
    );

    // The edit button text key is "projects.task.edit".
    const editBtn = screen.getByText("projects.task.edit");
    fireEvent.click(editBtn);

    expect(onEditTask).toHaveBeenCalledTimes(1);
    expect(onEditTask).toHaveBeenCalledWith(task);
  });
});
