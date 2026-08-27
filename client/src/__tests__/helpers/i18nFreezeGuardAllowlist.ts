/**
 * Known, pre-existing i18nFreezeGuard violations left un-fixed by task
 * a34078b6 Slice 3 (the PR closing PluginWorkspacePage.runError plus the
 * measured page-level toast.success/error/loading(t(...)) call sites).
 * Generated from a scan of the repo at the time this guard was added; see
 * i18nFreezeGuard.test.ts for how it is used (the repo-wide invariant test
 * asserts the scan result, MINUS these entries, is []).
 *
 * Each entry is a known follow-up, not an accepted permanent exception:
 * removing an entry here after fixing the underlying call site is the
 * expected way this list shrinks over time. Do not add a NEW entry to
 * silence a violation in code you are actively touching; fix it instead.
 */
import type { I18nFreezeViolation } from "./i18nFreezeGuardScan";

const EAGER_TRANSLATE_REASON =
  "Pre-existing eager-translate pattern: a plain error/status state or a toast call stores an already-translated string rather than a translation key. Out of scope for task a34078b6 Slice 3 (which fixes PluginWorkspacePage.runError plus the measured page-level toast.success/error/loading(t(...)) call sites); left as a known follow-up.";
const LOADER_DEP_REASON =
  "Pre-existing bare `t` in a useCallback/useEffect dependency array: re-fires the loader on every real language switch (see useLatest.ts doc comment). Out of scope for task a34078b6 Slice 3; left as a known follow-up.";

export const I18N_FREEZE_GUARD_ALLOWLIST: Array<
  Pick<I18nFreezeViolation, "file" | "line" | "kind"> & { reason: string }
> = [
  { file: "components/chat/CreateRoomModal.tsx", line: 44, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/CreateRoomModal.tsx", line: 52, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageActions.tsx", line: 37, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", line: 114, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", line: 119, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", line: 141, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", line: 193, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", line: 52, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", line: 56, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", line: 80, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", line: 84, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/UserList.tsx", line: 132, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/ProjectTeamTab.tsx", line: 67, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/ProjectTeamTab.tsx", line: 72, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 58, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "components/projects/SecretManager.tsx", line: 70, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 106, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 144, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 175, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 205, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", line: 226, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useProjectData.ts", line: 16, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "hooks/useProjectData.ts", line: 31, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useProjectData.ts", line: 34, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 91, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 114, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 142, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 181, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 189, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 221, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 265, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 273, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", line: 309, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", line: 148, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/AdminPage.tsx", line: 178, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", line: 191, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/AdminPage.tsx", line: 221, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", line: 332, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", line: 351, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", line: 365, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AgentConfigPage.tsx", line: 49, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/ApprovalsPage.tsx", line: 55, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/ApprovalsPage.tsx", line: 70, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ApprovalsPage.tsx", line: 88, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 158, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 163, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 168, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 173, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 177, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 182, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 186, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 190, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 194, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 198, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 202, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 208, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", line: 209, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectActivityPage.tsx", line: 94, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectDetailPage.tsx", line: 253, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectEditPage.tsx", line: 153, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectEditPage.tsx", line: 194, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectEditPage.tsx", line: 226, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SecretsPage.tsx", line: 133, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 135, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/SettingsPage.tsx", line: 147, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 159, kind: "loader-dep", reason: LOADER_DEP_REASON },
  { file: "pages/SettingsPage.tsx", line: 165, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 200, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 202, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 222, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 230, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 282, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 312, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 321, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 331, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 342, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 350, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 352, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 354, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 364, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", line: 372, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/UserConnectionsPage.tsx", line: 127, kind: "eager-translate", reason: EAGER_TRANSLATE_REASON },
];
