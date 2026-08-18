// @vitest-environment jsdom
/**
 * Render-level a11y guard for AdminPage's per-invite-code delete button
 * (a11y round 2, task 74d695bb, control 6/7 from PR #211's icon-only-button
 * sweep). See ConfirmDialogA11y.test.tsx for why a real render assertion is
 * needed in addition to the source-text guard in uiConsistency.test.ts.
 *
 * Like the room-delete button, this control's accessible name interpolates
 * the item's own code (admin.a11y.deleteInvite: "Delete invite code: {code}"),
 * so the render assertion also guards the interpolated value.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminPage } from "../pages/AdminPage";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const t = (key: string) =>
    key === "admin.a11y.deleteInvite" ? "Delete invite code: {code}" : key;
  const setLanguage = () => undefined;
  return {
    useLanguage: () => ({ t, language: "en", setLanguage }),
  };
});

vi.mock("../stores/agentStore", () => ({
  useAgentStore: Object.assign(
    () => ({ getAgentEmoji: () => "🤖" }),
    { getState: () => ({ getAgentEmoji: () => "🤖" }) },
  ),
}));

const emptyPage = (page = 1) => ({
  items: [],
  totalCount: 0,
  pageInfo: { page, limit: 12, totalPages: 1, hasMore: false, nextPage: null },
});

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async (path: string) => {
    if (path.startsWith("/api/admin/invite-codes")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "inv-1",
              code: "SUNSHINE1",
              createdBy: "user-1",
              maxUses: 5,
              useCount: 0,
              expiresAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
          totalCount: 1,
          pageInfo: { page: 1, limit: 12, totalPages: 1, hasMore: false, nextPage: null },
        }),
      };
    }
    if (path.startsWith("/api/admin/users")) {
      return { ok: true, status: 200, json: async () => emptyPage() };
    }
    if (path.startsWith("/api/agents")) {
      return { ok: true, status: 200, json: async () => emptyPage() };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }),
}));

describe("AdminPage invite-code delete button (RTL)", () => {
  it("exposes a named button interpolating the invite code's own value", async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    // Mutation-sensitive: fails if aria-label is dropped, or the {code}
    // interpolation regresses to the raw placeholder / a generic label.
    const deleteButton = await waitFor(() =>
      screen.getByRole("button", { name: "Delete invite code: SUNSHINE1" }),
    );
    expect(deleteButton.tagName).toBe("BUTTON");
  });
});
