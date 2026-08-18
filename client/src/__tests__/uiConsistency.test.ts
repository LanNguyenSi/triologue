import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

const read = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

// Locates the de / en block boundaries inside the translations object in
// LanguageContext.tsx and returns each block's lines. Assertions scoped to
// the correct block (rather than a whole-file toContain check) cannot pass
// on a bidirectional de<->en value swap.
const getLanguageBlocks = (i18n: string) => {
  const lines = i18n.split("\n");
  const deStart = lines.findIndex((l) => /^\s*de:\s*\{/.test(l));
  const enStart = lines.findIndex((l) => /^\s*en:\s*\{/.test(l));
  const blockEnd = lines.findIndex(
    (l, i) => i > enStart && /^\s*\};\s*$/.test(l),
  );
  expect(deStart).toBeGreaterThanOrEqual(0);
  expect(enStart).toBeGreaterThan(deStart);
  expect(blockEnd).toBeGreaterThan(enStart);
  return {
    de: lines.slice(deStart + 1, enStart),
    en: lines.slice(enStart + 1, blockEnd),
  };
};

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

  it("app-wide icon-only buttons carry accessible names present in both translation blocks", () => {
    const confirmDialog = read("client/src/components/ui/ConfirmDialog.tsx");
    const messageInput = read("client/src/components/chat/MessageInput.tsx");
    const sidebarRoomList = read("client/src/components/layout/SidebarRoomList.tsx");
    const appShell = read("client/src/components/layout/AppShell.tsx");
    const adminPage = read("client/src/pages/AdminPage.tsx");
    const agentConfigPage = read("client/src/pages/AgentConfigPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");
    const { de: deLines, en: enLines } = getLanguageBlocks(i18n);
    const deBlock = deLines.join("\n");
    const enBlock = enLines.join("\n");

    // ConfirmDialog's icon-only close button uses the shared common.close
    // i18n key (idiomatic AT name for an X), not the dialog's own
    // (often task-specific) cancelLabel. It still calls onCancel, the same
    // action as the text Cancel button, so no behavior change.
    expect(confirmDialog).toContain('aria-label={t("common.close")}');

    expect(messageInput).toContain('aria-label={t("chat.attachFile.remove")}');
    expect(appShell).toContain("aria-label={t('nav.closeSidebar')}");
    expect(appShell).toContain("aria-label={t('nav.openSidebar')}");

    // The room-delete and invite-delete buttons act on one row among many, so
    // (per repo convention, see the memory/secrets delete-label guard above)
    // their accessible name interpolates the item's own name/code rather than
    // reusing a generic label.
    expect(sidebarRoomList).toContain("const deleteRoomLabel = (name: string) =>");
    expect(sidebarRoomList).toContain("aria-label={deleteRoomLabel(room.name)}");
    expect(adminPage).toContain('const deleteInviteLabel = (code: string) =>');
    expect(adminPage).toContain("aria-label={deleteInviteLabel(c.code)}");

    // The AgentConfigPage Toggle switch reuses its own `label` prop (already
    // i18n-sourced by every call site), falling back to a generic i18n label
    // if that prop is ever empty or whitespace-only (e.g. server-sourced
    // connector names), so the accessible name can never be empty.
    expect(agentConfigPage).toContain('aria-label={label.trim() || t("agentConfig.toggle.fallback")}');

    expect(deBlock).toContain('"chat.attachFile.remove": "Angehängte Datei entfernen"');
    expect(enBlock).toContain('"chat.attachFile.remove": "Remove attached file"');
    expect(deBlock).toContain('"nav.a11y.deleteRoom": "Raum löschen: {name}"');
    expect(enBlock).toContain('"nav.a11y.deleteRoom": "Delete room: {name}"');
    expect(deBlock).toContain('"nav.closeSidebar": "Seitenleiste schließen"');
    expect(enBlock).toContain('"nav.closeSidebar": "Close sidebar"');
    expect(deBlock).toContain('"nav.openSidebar": "Seitenleiste öffnen"');
    expect(enBlock).toContain('"nav.openSidebar": "Open sidebar"');
    expect(deBlock).toContain('"admin.a11y.deleteInvite": "Invite-Code löschen: {code}"');
    expect(enBlock).toContain('"admin.a11y.deleteInvite": "Delete invite code: {code}"');
    expect(deBlock).toContain('"agentConfig.toggle.fallback": "Umschalter"');
    expect(enBlock).toContain('"agentConfig.toggle.fallback": "Toggle"');
    expect(deBlock).toContain('"common.close": "Schließen"');
    expect(enBlock).toContain('"common.close": "Close"');
  });

  it("a11y round 2: SecretsPage/AgentMemoryPage glyph dismiss buttons carry the shared common.close i18n aria-label", () => {
    // These two error-banner dismiss buttons render a literal Unicode "✕"
    // glyph as their only child (not a heroicons component), so the
    // repo-wide icon-only-button AST scanner cannot see them (it only
    // recognizes *Icon-suffixed component children). They needed a manual
    // fix instead of being caught by the scanner guard.
    const secretsPage = read("client/src/pages/SecretsPage.tsx");
    const memoryPage = read("client/src/pages/AgentMemoryPage.tsx");
    const i18n = read("client/src/contexts/LanguageContext.tsx");
    const { de: deLines, en: enLines } = getLanguageBlocks(i18n);
    const deBlock = deLines.join("\n");
    const enBlock = enLines.join("\n");

    expect(secretsPage).toContain("aria-label={t('common.close')}");
    expect(memoryPage).toContain('aria-label={t("common.close")}');
    expect(deBlock).toContain('"common.close": "Schließen"');
    expect(enBlock).toContain('"common.close": "Close"');
  });

  it("a11y round 2: AgentConfigPage Toggle announces its on/off state via role=switch + aria-checked", () => {
    const agentConfigPage = read("client/src/pages/AgentConfigPage.tsx");
    expect(agentConfigPage).toContain('role="switch"');
    expect(agentConfigPage).toContain("aria-checked={checked}");
  });

  it("LanguageContext de and en blocks have identical key sets (exhaustive parity)", () => {
    const { de: deLines, en: enLines } = getLanguageBlocks(
      read("client/src/contexts/LanguageContext.tsx"),
    );

    // Collect KEYS per block. The regex matches an entry's `"<key>":` start
    // whether its value is on the same line or the next one (the file mixes
    // single-line and multi-line entries), so it counts keys, not value lines.
    // A value-continuation line ("...some text...",) ends in a quote+comma, not
    // quote+colon, so it is not matched.
    const keysIn = (blockLines: string[]) => {
      const set = new Set<string>();
      for (const line of blockLines) {
        const m = line.match(/^\s*"([^"]+)":/);
        if (m) set.add(m[1]);
      }
      return set;
    };
    const de = keysIn(deLines);
    const en = keysIn(enLines);

    // A one-sided key renders as its raw key string for users in the missing
    // language; the de and en key sets must be identical.
    const onlyDe = [...de].filter((k) => !en.has(k)).sort();
    const onlyEn = [...en].filter((k) => !de.has(k)).sort();
    expect({ onlyDe, onlyEn }).toEqual({ onlyDe: [], onlyEn: [] });
    // Sanity: both blocks parsed non-trivially with the same key count (guards
    // against a broken-boundary false pass where a block parses as empty and
    // the set diffs come out empty for the wrong reason).
    expect(de.size).toBe(en.size);
    expect(de.size).toBeGreaterThan(1000);
  });
});
