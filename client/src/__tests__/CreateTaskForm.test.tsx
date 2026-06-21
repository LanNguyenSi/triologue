// @vitest-environment jsdom
/**
 * Behavioral smoke tests for CreateTaskForm.
 *
 * Follows EditTaskModal.test.tsx conventions:
 *   - MotionGlobalConfig.skipAnimations = true
 *   - RTL + cleanup() in afterEach
 *   - Mutation-sensitive: removing tested behavior from CreateTaskForm.tsx
 *     would fail the corresponding test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "framer-motion";
import { CreateTaskForm } from "../components/projects/CreateTaskForm";
import type { CreateTaskFields } from "../components/projects/CreateTaskForm";
import type { TeamMember } from "../projects/projectDomainTypes";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
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

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const makeTeamMembers = (): {
  ids: string[];
  lookup: Map<string, TeamMember>;
} => {
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

// ---------------------------------------------------------------------------
// 1. Renders form inputs
// ---------------------------------------------------------------------------
describe("CreateTaskForm renders correctly", () => {
  it("renders title input and description textarea", () => {
    const { ids, lookup } = makeTeamMembers();
    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    // Title input found by placeholder (t() returns the key as-is).
    const titleInput = screen.getByPlaceholderText(
      "projects.task.title.placeholder",
    );
    expect(titleInput).toBeTruthy();

    // Description textarea.
    const descTextarea = screen.getByPlaceholderText(
      "projects.task.description.placeholder",
    );
    expect(descTextarea).toBeTruthy();
  });

  it("renders submit and cancel buttons", () => {
    const { ids, lookup } = makeTeamMembers();
    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("projects.create")).toBeTruthy();
    expect(screen.getByText("projects.cancel")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Empty title is blocked
// ---------------------------------------------------------------------------
describe("CreateTaskForm empty-title guard", () => {
  it("does not call onSubmit when title is empty", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    // Click submit without entering a title.
    fireEvent.click(screen.getByText("projects.create"));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not call onSubmit when the title is only whitespace (JS trim guard, not native required)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    // Whitespace satisfies the native `required` attribute, so submission is
    // NOT blocked by the browser; only the component's `!title.trim()` guard
    // stops it. Removing that guard would let this through.
    await user.type(
      screen.getByPlaceholderText("projects.task.title.placeholder"),
      "   ",
    );
    fireEvent.click(screen.getByText("projects.create"));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Submit calls onSubmit with entered fields
// ---------------------------------------------------------------------------
describe("CreateTaskForm submit", () => {
  it("calls onSubmit with the entered title and default assignee", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    const titleInput = screen.getByPlaceholderText(
      "projects.task.title.placeholder",
    );
    await user.type(titleInput, "My new task");

    fireEvent.click(screen.getByText("projects.create"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [fields] = onSubmit.mock.calls[0] as [CreateTaskFields];
    expect(fields.title).toBe("My new task");
    expect(fields.assignedTo).toBe("user-1");
    expect(fields.reviewedBy).toBeNull();
    expect(fields.files).toHaveLength(0);
  });

  it("calls onClose after onSubmit resolves", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("projects.task.title.placeholder"),
      "Close test task",
    );
    fireEvent.click(screen.getByText("projects.create"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onClose when onSubmit rejects", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("api error"));
    const onClose = vi.fn();
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("projects.task.title.placeholder"),
      "Error task",
    );
    fireEvent.click(screen.getByText("projects.create"));

    // Wait for the async handler to finish.
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // onClose must NOT have been called because the submit failed.
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Cancel button calls onClose
// ---------------------------------------------------------------------------
describe("CreateTaskForm cancel", () => {
  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    const { ids, lookup } = makeTeamMembers();

    render(
      <CreateTaskForm
        teamMemberIds={ids}
        teamMemberLookup={lookup}
        defaultAssigneeId="user-1"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("projects.cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
