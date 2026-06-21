// @vitest-environment jsdom
/**
 * Behavioral smoke tests for EditTaskModal.
 *
 * Follows Modal.test.tsx conventions:
 *   - MotionGlobalConfig.skipAnimations = true
 *   - RTL + cleanup() in afterEach
 *   - Mutation-sensitive: removing tested behavior from EditTaskModal.tsx
 *     would fail the corresponding test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "framer-motion";
import { EditTaskModal } from "../components/projects/EditTaskModal";
import type { Task, TeamMember } from "../projects/projectDomainTypes";
import type { EditTaskFields } from "../hooks/useTaskManagement";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  projectId: "proj-1",
  title: "Fix the bug",
  description: "It is a bad bug",
  status: "todo",
  assignedTo: "user-1",
  reviewedBy: null,
  reviewer: null,
  priority: "high",
  usedMemoryIds: [],
  attachments: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const makeTeamMembers = (): { ids: string[]; lookup: Map<string, TeamMember> } => {
  const members: TeamMember[] = [
    {
      id: "user-1",
      username: "alice",
      displayName: "Alice",
      userType: "HUMAN",
    },
    {
      id: "user-2",
      username: "bob",
      displayName: "Bob",
      userType: "HUMAN",
    },
  ];
  const lookup = new Map(members.map((m) => [m.id, m]));
  const ids = members.map((m) => m.id);
  return { ids, lookup };
};

// Minimal mock of language context so i18n keys render as-is.
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
// 1. Renders fields seeded from task when open
// ---------------------------------------------------------------------------
describe("EditTaskModal renders correctly", () => {
  it("renders task title in the input when open=true with a task", () => {
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();
    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    // The input should be seeded with the task title.
    const input = screen.getByDisplayValue("Fix the bug");
    expect(input).toBeTruthy();
  });

  it("focuses the title input on open (via Modal initialFocusRef, not the header Cancel button)", () => {
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();
    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    const titleInput = screen.getByDisplayValue("Fix the bug");
    expect(document.activeElement).toBe(titleInput);
  });

  it("does not render content when open=false", async () => {
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();
    render(
      <EditTaskModal
        open={false}
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    // Dialog should not be present.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 2. Escape key calls onClose
// ---------------------------------------------------------------------------
describe("EditTaskModal Escape key", () => {
  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();

    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={onClose}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose on Escape when saving=true", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();

    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving
        onClose={onClose}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT call onClose on Escape when suppressEscape=true (delete confirm stacked on top)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();

    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        suppressEscape
        onClose={onClose}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Save button calls onSave with edited fields
// ---------------------------------------------------------------------------
describe("EditTaskModal Save", () => {
  it("calls onSave with the task id and current field values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const task = makeTask({ title: "Original title" });
    const { ids, lookup } = makeTeamMembers();

    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
        onRequestDelete={vi.fn()}
      />,
    );

    // Clear the title input and type a new value.
    const titleInput = screen.getByDisplayValue("Original title");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title");

    // Click the save button (text key "projects.task.save").
    const saveBtn = screen.getByText("projects.task.save");
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [calledTaskId, calledFields] = onSave.mock.calls[0] as [
      string,
      EditTaskFields,
    ];
    expect(calledTaskId).toBe("task-1");
    expect(calledFields.title).toBe("Updated title");
  });
});

// ---------------------------------------------------------------------------
// 4. Delete button calls onRequestDelete
// ---------------------------------------------------------------------------
describe("EditTaskModal Delete", () => {
  it("calls onRequestDelete with the task id when Delete is clicked", () => {
    const onRequestDelete = vi.fn();
    const task = makeTask();
    const { ids, lookup } = makeTeamMembers();

    render(
      <EditTaskModal
        open
        task={task}
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={onRequestDelete}
      />,
    );

    // Delete button key is "projects.task.delete".
    const deleteBtn = screen.getByText("projects.task.delete");
    fireEvent.click(deleteBtn);

    expect(onRequestDelete).toHaveBeenCalledWith("task-1");
  });
});
