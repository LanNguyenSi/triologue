import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

const read = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("UI consistency guards", () => {
  it("uses common cancel wording outside chat-specific flows", () => {
    const settings = read("client/src/pages/SettingsPage.tsx");
    const admin = read("client/src/pages/AdminPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(settings).toContain('cancelLabel={t("common.cancel")}');
    expect(admin).toContain('cancelLabel={t("common.cancel")}');
    expect(i18n).toContain('"common.cancel": "Abbrechen"');
    expect(i18n).toContain('"common.cancel": "Cancel"');
  });

  it("keeps room delete dialog wording on nav keys and removes legacy chat keys", () => {
    // Sidebar.tsx was removed (dead component). AppShell.tsx is the live shell that
    // owns the delete-room ConfirmDialog and carries this guard forward.
    const appShell = read("client/src/components/layout/AppShell.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(appShell).toContain("title={t('nav.deleteRoom.title')}");
    expect(appShell).toContain("message={t('nav.deleteRoom.message').replace(");
    expect(appShell).toContain("confirmLabel={t('nav.deleteConfirm')}");
    expect(appShell).toContain("cancelLabel={t('nav.deleteCancel')}");
    expect(i18n).not.toContain('"chat.deleteRoom":');
    expect(i18n).not.toContain('"chat.deleteRoomTitle":');
    expect(i18n).not.toContain('"chat.deleteRoomConfirm":');
  });

  it("keeps delete button tooltip labels specific on memory and secrets lists", () => {
    const memoryPage = read("client/src/pages/AgentMemoryPage.tsx");
    const secretsPage = read("client/src/pages/SecretsPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(memoryPage).toContain('const deleteMemoryLabel = (name: string) =>');
    expect(memoryPage).toContain('title={deleteMemoryLabel(entry.title || t("memory.list.untitled"))}');
    expect(secretsPage).toContain("const deleteSecretLabel = (name: string) =>");
    expect(secretsPage).toContain("title={deleteSecretLabel(s.name)}");

    expect(i18n).toContain('"memory.a11y.deleteEntry": "Memory löschen: {name}"');
    expect(i18n).toContain('"secrets.a11y.deleteSecret": "Secret löschen: {name}"');
    expect(i18n).toContain('"memory.a11y.deleteEntry": "Delete memory entry: {name}"');
    expect(i18n).toContain('"secrets.a11y.deleteSecret": "Delete secret: {name}"');
  });

  it("keeps export actions on detail pages, not list pages, for memory and secrets", () => {
    const memoryPage = read("client/src/pages/AgentMemoryPage.tsx");
    const secretsPage = read("client/src/pages/SecretsPage.tsx");
    const memoryDetail = read("client/src/pages/AgentMemoryDetailPage.tsx");
    const secretDetail = read("client/src/pages/SecretDetailPage.tsx");

    expect(memoryPage).not.toContain('t("memory.actions.export")');
    expect(secretsPage).not.toContain("t('secrets.actions.exportMetadata')");

    expect(memoryDetail).toContain('t("memory.actions.export")');
    expect(secretDetail).toContain('t("secrets.actions.exportMetadata")');
  });
});
