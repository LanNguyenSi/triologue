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

  it("FilesPage uses i18n keys and both translation blocks contain them", () => {
    const filesPage = read("client/src/pages/FilesPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(filesPage).toContain('t("files.pageTitle")');
    expect(filesPage).toContain('t("files.browser.uploadFile")');

    expect(i18n).toContain('"files.pageTitle": "Dateien"');
    expect(i18n).toContain('"files.pageTitle": "Files"');
    expect(i18n).toContain('"files.browser.uploadFile": "Datei hochladen"');
    expect(i18n).toContain('"files.browser.uploadFile": "Upload File"');
  });

  it("AgentConfigPage uses i18n keys and both translation blocks contain them", () => {
    const agentConfigPage = read("client/src/pages/AgentConfigPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(agentConfigPage).toContain('t("agentConfig.section.communication")');
    expect(agentConfigPage).toContain('t("agentConfig.button.save")');

    expect(i18n).toContain('"agentConfig.section.communication": "Kommunikation"');
    expect(i18n).toContain('"agentConfig.section.communication": "Communication"');
    expect(i18n).toContain('"agentConfig.button.save": "Speichern"');
    expect(i18n).toContain('"agentConfig.button.save": "Save"');
  });

  it("UserConnectionsPage uses i18n keys and both translation blocks contain them", () => {
    const userConnectionsPage = read("client/src/pages/UserConnectionsPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(userConnectionsPage).toContain('t("userConnections.pageTitle")');
    expect(userConnectionsPage).toContain('"userConnections.status.connected"');

    expect(i18n).toContain('"userConnections.pageTitle": "Meine Verbindungen"');
    expect(i18n).toContain('"userConnections.pageTitle": "My Connections"');
    expect(i18n).toContain('"userConnections.status.connected": "Verbunden"');
    expect(i18n).toContain('"userConnections.status.connected": "Connected"');
  });

  it("ProjectActivityPage uses i18n keys and both translation blocks contain them", () => {
    const projectActivityPage = read("client/src/pages/ProjectActivityPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(projectActivityPage).toContain('t("projectActivity.time.justNow")');
    expect(projectActivityPage).toContain('"projectActivity.action.messageSend"');

    expect(i18n).toContain('"projectActivity.time.justNow": "gerade eben"');
    expect(i18n).toContain('"projectActivity.time.justNow": "just now"');
    expect(i18n).toContain('"projectActivity.action.messageSend": "Nachricht gesendet"');
    expect(i18n).toContain('"projectActivity.action.messageSend": "Message sent"');
  });

  it("Admin and Inbox icon-only buttons carry i18n aria-labels present in both translation blocks", () => {
    const adminPage = read("client/src/pages/AdminPage.tsx");
    const inboxPage = read("client/src/pages/InboxPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");

    expect(adminPage).toContain('aria-label={t("admin.agent.configure")}');
    expect(inboxPage).toContain("aria-label={t('inbox.item.markRead')}");
    expect(inboxPage).toContain("aria-label={t('inbox.item.delete')}");

    expect(i18n).toContain('"admin.agent.configure": "Agent konfigurieren"');
    expect(i18n).toContain('"admin.agent.configure": "Configure agent"');
    expect(i18n).toContain('"inbox.item.markRead": "Als gelesen markieren"');
    expect(i18n).toContain('"inbox.item.markRead": "Mark as read"');
    expect(i18n).toContain('"inbox.item.delete": "Eintrag löschen"');
    expect(i18n).toContain('"inbox.item.delete": "Delete item"');
  });

  it("LanguageContext de and en blocks have identical key sets (exhaustive parity)", () => {
    const lines = read("client/src/contexts/LanguageContext.tsx").split("\n");

    // Locate the de / en block boundaries inside the translations object.
    const deStart = lines.findIndex((l) => /^\s*de:\s*\{/.test(l));
    const enStart = lines.findIndex((l) => /^\s*en:\s*\{/.test(l));
    const blockEnd = lines.findIndex(
      (l, i) => i > enStart && /^\s*\};\s*$/.test(l),
    );
    expect(deStart).toBeGreaterThanOrEqual(0);
    expect(enStart).toBeGreaterThan(deStart);
    expect(blockEnd).toBeGreaterThan(enStart);

    // Collect KEYS per block. The regex matches an entry's `"<key>":` start
    // whether its value is on the same line or the next one (the file mixes
    // single-line and multi-line entries), so it counts keys, not value lines.
    // A value-continuation line ("...some text...",) ends in a quote+comma, not
    // quote+colon, so it is not matched.
    const keysIn = (from: number, to: number) => {
      const set = new Set<string>();
      for (let i = from; i < to; i++) {
        const m = lines[i].match(/^\s*"([^"]+)":/);
        if (m) set.add(m[1]);
      }
      return set;
    };
    const de = keysIn(deStart + 1, enStart);
    const en = keysIn(enStart + 1, blockEnd);

    // A one-sided key renders as its raw key string for users in the missing
    // language; the de and en key sets must be identical.
    const onlyDe = [...de].filter((k) => !en.has(k)).sort();
    const onlyEn = [...en].filter((k) => !de.has(k)).sort();
    expect({ onlyDe, onlyEn }).toEqual({ onlyDe: [], onlyEn: [] });
    // Sanity: both blocks are non-trivial (guards against a broken-boundary
    // false pass where both sets come out empty).
    expect(de.size).toBeGreaterThan(500);
  });
});
