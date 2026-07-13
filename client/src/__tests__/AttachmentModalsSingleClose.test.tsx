// @vitest-environment jsdom
/**
 * Regression tests pinning the single-close-control invariant established by
 * PR #154 ("fix(ui): drop duplicate footer close button in attachment
 * modals"). Before that fix, TaskAttachmentsModal and ProjectAttachmentsModal
 * each rendered two "Close" buttons (a SectionHeader action and a redundant
 * footer button), both wired to onClose.
 *
 * `screen.getByRole("button", { name: ... })` throws if more than one match
 * is found, so a re-added footer close button makes these tests fail red
 * (verified manually by re-adding the footer block and observing the
 * failure before reverting).
 *
 * Renders through real ThemeProvider + LanguageProvider (not mocked), so the
 * ProjectAttachmentsModal i18n-namespace fix (projects.attachments.close,
 * introduced alongside these tests) is exercised end-to-end.
 *
 * Follows Modal.test.tsx / CreateRoomModal.test.tsx conventions:
 *   - MotionGlobalConfig.skipAnimations = true
 *   - RTL + cleanup() in afterEach
 *   - localStorage seeded so language/theme are deterministic (both
 *     providers read localStorage in their useState initializer).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";
import { TaskAttachmentsModal } from "../components/projects/TaskAttachmentsModal";
import { ProjectAttachmentsModal } from "../components/projects/ProjectAttachmentsModal";
import type { Task } from "../projects/projectDomainTypes";

MotionGlobalConfig.skipAnimations = true;

const CLOSE_EN = "Close";

beforeEach(() => {
  // Render in English for deterministic text assertions (both providers read
  // localStorage in their useState initializer, before the first render).
  localStorage.setItem("triologue_language", "en");
  localStorage.setItem("triologue_theme", "dark");
});

afterEach(() => {
  cleanup();
});

const withProviders = (children: React.ReactNode) =>
  render(
    <ThemeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </ThemeProvider>,
  );

const getBackdrop = () => {
  const backdrop = document.querySelector('div[aria-hidden="true"]');
  if (!backdrop) throw new Error("Modal backdrop not found");
  return backdrop;
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  projectId: "proj-1",
  title: "Fix the bug",
  status: "todo",
  assignedTo: "user-1",
  reviewedBy: null,
  reviewer: null,
  attachments: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// TaskAttachmentsModal
// ---------------------------------------------------------------------------
describe("TaskAttachmentsModal single close control", () => {
  const renderModal = (onClose = vi.fn()) => {
    withProviders(
      <TaskAttachmentsModal
        open
        onClose={onClose}
        task={makeTask()}
        isTeamMember
        isOwner
        user={null}
        uploading={{}}
        deleting={{}}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    return onClose;
  };

  it("exposes exactly one close control, wired to onClose", () => {
    const onClose = renderModal();

    // getByRole throws if more than one "Close" button is found, pinning the
    // single-close-control invariant.
    const closeButton = screen.getByRole("button", { name: CLOSE_EN });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape when not uploading", () => {
    const onClose = renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click when not uploading", () => {
    const onClose = renderModal();

    fireEvent.click(getBackdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ProjectAttachmentsModal
// ---------------------------------------------------------------------------
describe("ProjectAttachmentsModal single close control", () => {
  const renderModal = (onClose = vi.fn()) => {
    withProviders(
      <ProjectAttachmentsModal
        open
        onClose={onClose}
        attachments={[]}
        isTeamMember
        isOwner
        user={null}
        uploading={false}
        deleting={{}}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    return onClose;
  };

  it("exposes exactly one close control, wired to onClose", () => {
    const onClose = renderModal();

    const closeButton = screen.getByRole("button", { name: CLOSE_EN });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape when not uploading", () => {
    const onClose = renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click when not uploading", () => {
    const onClose = renderModal();

    fireEvent.click(getBackdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
