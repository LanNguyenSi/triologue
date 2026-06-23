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

// ---------------------------------------------------------------------------
// 5. Every control has a visible, localized label
// ---------------------------------------------------------------------------
describe("EditTaskModal labeled fields", () => {
  it("renders a visible label for every control (title/description/priority/assignee/reviewer)", () => {
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

    // Labels render their localized text (mock returns the key as-is).
    expect(screen.getByText("projects.task.field.title")).toBeTruthy();
    expect(screen.getByText("projects.task.field.description")).toBeTruthy();
    expect(screen.getByText("projects.task.field.priority")).toBeTruthy();
    expect(screen.getByText("projects.task.field.assignee")).toBeTruthy();
    expect(screen.getByText("projects.task.field.reviewer")).toBeTruthy();

    // The label is tied to its control via htmlFor/id: the title field is
    // reachable through its accessible name.
    expect(
      screen.getByLabelText("projects.task.field.title"),
    ).toBe(screen.getByDisplayValue("Fix the bug"));
  });
});

// ---------------------------------------------------------------------------
// 6. Reviewer empty option uses the localized noReviewer label
// ---------------------------------------------------------------------------
describe("EditTaskModal reviewer placeholder", () => {
  it("shows the localized noReviewer label, not a hardcoded string", () => {
    const task = makeTask({ reviewedBy: null });
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

    // The reviewer Select shows the empty option label for the selected "" value.
    expect(screen.getByText("projects.task.noReviewer")).toBeTruthy();
    // The old hardcoded literal must be gone.
    expect(screen.queryByText("No reviewer")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. The memory-ids field lives behind an Advanced disclosure
// ---------------------------------------------------------------------------
describe("EditTaskModal advanced disclosure", () => {
  it("hides the memory-ids field until Advanced is expanded", async () => {
    const user = userEvent.setup();
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

    // Collapsed by default: the memory-ids field is not in the document.
    expect(screen.queryByLabelText("projects.task.field.memoryIds")).toBeNull();
    expect(screen.queryByText("projects.task.memoryIds.helper")).toBeNull();

    // Expanding the disclosure reveals the labeled field and its helper text.
    await user.click(screen.getByText("projects.task.advanced"));
    expect(
      screen.getByLabelText("projects.task.field.memoryIds"),
    ).toBeTruthy();
    expect(screen.getByText("projects.task.memoryIds.helper")).toBeTruthy();
  });

  it("never renders the old raw usedMemoryIds placeholder", () => {
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

    expect(
      screen.queryByPlaceholderText("usedMemoryIds (comma separated)"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Save is disabled without a title and an assignee
// ---------------------------------------------------------------------------
describe("EditTaskModal save guard", () => {
  it("disables Save when the task has no title and no assignee", () => {
    const task = makeTask({ title: "", assignedTo: "" });
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

    const saveBtn = screen.getByText("projects.task.save").closest("button");
    expect(saveBtn).not.toBeNull();
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Save when both title and assignee are present", () => {
    const task = makeTask({ title: "Has title", assignedTo: "user-1" });
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

    const saveBtn = screen.getByText("projects.task.save").closest("button");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
