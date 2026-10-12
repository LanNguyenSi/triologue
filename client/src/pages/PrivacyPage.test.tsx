// @vitest-environment jsdom
/**
 * The retention section of the privacy page must describe what the server's
 * self-service account deletion does: messages stay without a sender unless
 * the opt-in is used, reactions and room memberships are removed. The old
 * blanket "everything is permanently deleted (cascade)" claim must stay gone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../contexts/LanguageContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { PrivacyPage } from "./PrivacyPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPage(lang: "de" | "en") {
  localStorage.setItem("triologue_language", lang);
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <LanguageProvider>
          <PrivacyPage />
        </LanguageProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("PrivacyPage account deletion wording", () => {
  it("states the opt-in message behaviour in English and drops the cascade claim", () => {
    const { container } = renderPage("en");
    const text = container.textContent ?? "";
    expect(screen.getByText("5. Data Retention")).toBeTruthy();
    expect(text).toContain("stay in their rooms without a sender");
    expect(text).not.toContain("shared rooms");
    expect(text).toContain("overwritten as they rotate");
    expect(text).toContain("Last updated: October 2026");
    expect(text).toContain("Also delete my messages");
    expect(text).toContain("removed permanently");
    expect(text).not.toMatch(/cascade/i);
    expect(text).not.toContain("all associated messages");
    expect(text).not.toContain("all associated data");
  });

  it("states the opt-in message behaviour in German and drops the cascade claim", () => {
    const { container } = renderPage("de");
    const text = container.textContent ?? "";
    expect(screen.getByText("5. Speicherdauer")).toBeTruthy();
    expect(text).toContain("bleiben in ihren Räumen ohne Absender erhalten");
    expect(text).not.toContain("geteilten Räumen");
    expect(text).toContain("bei der Rotation überschrieben");
    expect(text).toContain("Zuletzt aktualisiert: Oktober 2026");
    expect(text).toContain("Auch meine Nachrichten löschen");
    expect(text).toContain("unwiderruflich entfernt");
    expect(text).not.toMatch(/cascade/i);
    expect(text).not.toContain("alle zugehörigen Nachrichten");
    expect(text).not.toContain("aller zugehörigen Daten");
  });
});
