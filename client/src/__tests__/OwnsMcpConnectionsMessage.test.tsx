// @vitest-environment jsdom
/**
 * The dedicated delete-account message for a user who still owns MCP
 * connections (task 18620b53) exists in both languages, is not the key
 * itself, and is not the generic conflict message.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LanguageProvider, useLanguage } from "../contexts/LanguageContext";

const KEY = "settings.error.deleteAccountOwnsMcpConnections";
const GENERIC_KEY = "settings.error.deleteAccountConflict";

function Probe() {
  const { t } = useLanguage();
  return (
    <>
      <p data-testid="dedicated">{t(KEY)}</p>
      <p data-testid="generic">{t(GENERIC_KEY)}</p>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("owns_mcp_connections delete-account message", () => {
  it.each([
    ["en", /administrator/i],
    ["de", /Administrator/],
  ])("has a dedicated %s translation that names the admin action", (language, adminWord) => {
    localStorage.setItem("triologue_language", language);
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    const dedicated = screen.getByTestId("dedicated").textContent ?? "";
    const generic = screen.getByTestId("generic").textContent ?? "";
    expect(dedicated).not.toBe(KEY);
    expect(dedicated).not.toBe(generic);
    expect(dedicated).toMatch(/MCP/);
    expect(dedicated).toMatch(adminWord);
  });
});
