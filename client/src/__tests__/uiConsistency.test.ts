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
});
