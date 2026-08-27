/**
 * Known, pre-existing i18nFreezeGuard violations left un-fixed. Generated
 * from a scan of the repo; see i18nFreezeGuard.test.ts for how it is used
 * (the repo-wide invariant test asserts the scan result, MINUS these
 * entries, is []).
 *
 * Keyed by file + kind + a whitespace-collapsed snippet of the call site's
 * own text (NOT by line number). A file:line key churns on every unrelated
 * edit above the flagged line (inserting or removing even one blank line
 * shifts every subsequent line number, making the guard either miss a real
 * violation whose line moved, or flag a stale entry that no longer exists)
 * without the underlying code having changed at all. The snippet key is
 * insensitive to that: it only changes when the flagged call site's own
 * text changes. Line number is deliberately NOT part of this entry's key
 * (see i18nFreezeGuardScan.ts's `normalizeSnippet`); when a violation is
 * unexpected or an entry goes stale, the test failure output still prints
 * the CURRENT line from the scan's I18nFreezeViolation, so you get a
 * locate-it-faster hint without it being load-bearing for matching.
 *
 * Each entry is a known follow-up, not an accepted permanent exception:
 * removing an entry here after fixing the underlying call site is the
 * expected way this list shrinks over time. Do not add a NEW entry to
 * silence a violation in code you are actively touching; fix it instead.
 *
 * Fails closed in both directions: a NEW violation (even one that happens
 * to land in a file with other allowlisted entries) is not matched by any
 * entry's snippet and is reported; an ORPHANED entry (its snippet no
 * longer appears in the scan, e.g. because the call site was fixed without
 * removing the entry here) is reported as stale by the second test below.
 */
import type { I18nFreezeViolation } from "./i18nFreezeGuardScan";

const EAGER_TRANSLATE_REASON =
  "Pre-existing eager-translate site, not yet converted; see CHANGELOG [Unreleased] for the i18n-freeze guard's scope.";
const LOADER_DEP_REASON =
  "Pre-existing bare `t` in a useCallback/useEffect/useLayoutEffect dependency array: re-fires the loader on every real language switch (see useLatest.ts doc comment); see CHANGELOG [Unreleased] for the i18n-freeze guard's scope.";

export interface I18nFreezeGuardAllowlistEntry {
  file: string;
  kind: I18nFreezeViolation["kind"];
  /** Whitespace-collapsed call/dep-array text; the actual matching key (see module doc comment). */
  snippet: string;
  reason: string;
}

export const I18N_FREEZE_GUARD_ALLOWLIST: I18nFreezeGuardAllowlistEntry[] = [
  { file: "components/chat/ChatHeader.tsx", kind: "eager-translate", snippet: "setInviteStatus({ type: \"err\", msg: t(\"chat.invite.networkError\") })", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/CreateRoomModal.tsx", kind: "eager-translate", snippet: "setError(t('chat.roomNameRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/CreateRoomModal.tsx", kind: "eager-translate", snippet: "setError(err instanceof Error ? err.message : t('chat.createFailed'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageActions.tsx", kind: "eager-translate", snippet: "toast.success(t(\"chat.copied\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", kind: "eager-translate", snippet: "toast.error(t(\"chat.fileTypeNotAllowed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", kind: "eager-translate", snippet: "toast.error(t(\"chat.fileTooLarge\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", kind: "eager-translate", snippet: "toast.error(t(\"chat.readOnlyClosedProjectHint\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageInput.tsx", kind: "eager-translate", snippet: "toast.error(error instanceof Error ? error.message : t(\"chat.uploadFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", kind: "eager-translate", snippet: "toast.error(t(\"chat.deleteMessageFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", kind: "eager-translate", snippet: "toast.error(t(\"chat.deleteMessageError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/MessageItem.tsx", kind: "eager-translate", snippet: "toast.error(message.isPinned ? t(\"chat.unpinFailed\") : t(\"chat.pinFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/chat/UserList.tsx", kind: "eager-translate", snippet: "setInviteError(t(\"chat.networkError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/ProjectTeamTab.tsx", kind: "eager-translate", snippet: "setInviteStatus(data.error || t(\"projects.team.invite.failed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/ProjectTeamTab.tsx", kind: "eager-translate", snippet: "setInviteStatus(t(\"projects.team.invite.success\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/ProjectTeamTab.tsx", kind: "eager-translate", snippet: "setInviteStatus(t(\"projects.team.invite.networkError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "loader-dep", snippet: "useCallback(async () => { setLoading(true); try { const res = await apiClient(`/api/projects/${projectId}/secrets`); if (!res.ok) { throw new Error(t('secrets.error.load')); } setSecrets(await res.json()); setError(''); } catch (err) { setError(t('secrets.error.load')); console.error(err); } finally { setLoading(false); } }, [projectId, t])", reason: LOADER_DEP_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setError(t('secrets.error.load'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setError(t('secrets.error.create'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setError(t('secrets.error.update'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setError(t('secrets.error.delete'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setShareError(t('secrets.error.permissions'))", reason: EAGER_TRANSLATE_REASON },
  { file: "components/projects/SecretManager.tsx", kind: "eager-translate", snippet: "setError(t('secrets.error.permissions'))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useProjectData.ts", kind: "loader-dep", snippet: "useCallback(async () => { if (!projectId) return; setLoading(true); try { const res = await api(`/api/projects/${projectId}`); if (res.ok) { const data = await res.json(); setProject({ ...data, workflowConfig: normalizeWorkflowConfig(data.workflowConfig), projectContext: normalizeProjectContext(data.projectContext), }); setTasks(data.tasks || []); setError(\"\"); } else { setError(t(\"projects.detail.notFound\")); } } catch (err) { setError(t(\"projects.detail.loadError\")); console.error(err); } finally { setLoading(false); } }, [projectId, t])", reason: LOADER_DEP_REASON },
  { file: "hooks/useProjectData.ts", kind: "eager-translate", snippet: "setError(t(\"projects.detail.notFound\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useProjectData.ts", kind: "eager-translate", snippet: "setError(t(\"projects.detail.loadError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(data.error || t(\"projects.task.update.failed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.task.update.failed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(data.error || t(\"projects.task.delete.failed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.task.delete.failed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error( failedUploads === files.length ? t(\"projects.task.attachment.uploadFailed\") : t(\"projects.task.attachment.uploadPartialFailed\"), )", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.task.attachment.uploadFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(data.error || t(\"projects.task.attachment.deleteFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.task.attachment.deleteFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error( failedUploads === files.length ? t(\"projects.attachments.uploadFailed\") : t(\"projects.attachments.uploadPartialFailed\"), )", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.attachments.uploadFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(data.error || t(\"projects.attachments.deleteFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "hooks/useTaskManagement.ts", kind: "eager-translate", snippet: "toast.error(t(\"projects.attachments.deleteFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", kind: "loader-dep", snippet: "useCallback( async (page = 1) => { setUsersLoading(true); try { const params = new URLSearchParams(); params.set(\"limit\", String(USERS_PAGE_SIZE)); params.set(\"page\", String(page)); const res = await apiClient(`/api/admin/users?${params.toString()}`); if (res.status === 403) { navigate(\"/\"); return; } if (!res.ok) { throw new Error(`Failed to load users (${res.status})`); } const data = await res.json(); const payload = data as UserListResponse; const items = payload.items ?? payload.users ?? []; const totalCount = payload.totalCount ?? items.length; const totalPages = payload.pageInfo?.totalPages ?? Math.max(1, Math.ceil(totalCount / USERS_PAGE_SIZE)); const currentPage = payload.pageInfo?.page ?? page; setUsers(items); setUserTotalCount(totalCount); setUserPage(currentPage); setUserTotalPages(totalPages); setUserHasMore(payload.pageInfo?.hasMore ?? currentPage < totalPages); } catch { setError(t(\"admin.error.loadUsers\")); setUsers([]); setUserTotalCount(0); setUserPage(1); setUserTotalPages(1); setUserHasMore(false); } finally { setUsersLoading(false); } }, [t, navigate], )", reason: LOADER_DEP_REASON },
  { file: "pages/AdminPage.tsx", kind: "eager-translate", snippet: "setError(t(\"admin.error.loadUsers\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", kind: "loader-dep", snippet: "useCallback( async (page = 1) => { setInvitesLoading(true); try { const params = new URLSearchParams(); params.set(\"limit\", String(INVITES_PAGE_SIZE)); params.set(\"page\", String(page)); const res = await apiClient(`/api/admin/invite-codes?${params.toString()}`); if (res.status === 403) { navigate(\"/\"); return; } if (!res.ok) { throw new Error(`Failed to load invite codes (${res.status})`); } const data = await res.json(); const payload = data as InviteCodeListResponse; const items = payload.items ?? payload.codes ?? []; const totalCount = payload.totalCount ?? items.length; const totalPages = payload.pageInfo?.totalPages ?? Math.max(1, Math.ceil(totalCount / INVITES_PAGE_SIZE)); const currentPage = payload.pageInfo?.page ?? page; setCodes(items); setInviteTotalCount(totalCount); setInvitePage(currentPage); setInviteTotalPages(totalPages); setInviteHasMore(payload.pageInfo?.hasMore ?? currentPage < totalPages); } catch { setError(t(\"admin.error.loadInvites\")); setCodes([]); setInviteTotalCount(0); setInvitePage(1); setInviteTotalPages(1); setInviteHasMore(false); } finally { setInvitesLoading(false); } }, [t, navigate], )", reason: LOADER_DEP_REASON },
  { file: "pages/AdminPage.tsx", kind: "eager-translate", snippet: "setError(t(\"admin.error.loadInvites\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", kind: "eager-translate", snippet: "setError(t(\"admin.error.updateUser\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", kind: "eager-translate", snippet: "setError(t(\"admin.error.createCode\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/AdminPage.tsx", kind: "eager-translate", snippet: "setError(t(\"admin.error.deleteCode\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ApprovalsPage.tsx", kind: "loader-dep", snippet: "useCallback(async () => { setLoading(true); setError(null); try { const res = await apiClient(`/api/approvals`); if (!res.ok) throw new Error(`HTTP ${res.status}`); const data = await res.json() as { approvals?: ApprovalRequest[] }; const items = data.approvals ?? []; items.sort((a, b) => { if (a.status === 'pending' && b.status !== 'pending') return -1; if (a.status !== 'pending' && b.status === 'pending') return 1; return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); }); setApprovals(items); } catch { setError(t('approvals.error.load')); } finally { setLoading(false); } }, [t])", reason: LOADER_DEP_REASON },
  { file: "pages/ApprovalsPage.tsx", kind: "eager-translate", snippet: "setError(t('approvals.error.load'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ApprovalsPage.tsx", kind: "eager-translate", snippet: "setError(t('approvals.error.decide'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.usernameRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setFieldErrors({ username: t('error.usernameRequired') })", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.usernameFormat'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setFieldErrors({ username: t('error.usernameFormat') })", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.usernameTaken'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setFieldErrors({ username: t('error.usernameTaken') })", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.displayNameRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.emailRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setFieldErrors({ email: t('error.emailRequired') })", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.passwordRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.passwordMin'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.passwordComplexity'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.passwordMismatch'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.inviteRequired'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/LoginPage.tsx", kind: "eager-translate", snippet: "setError(t('error.registrationClosed'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/ProjectActivityPage.tsx", kind: "eager-translate", snippet: "setError(t(\"projectActivity.error.loadActivity\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SecretsPage.tsx", kind: "eager-translate", snippet: "setError(err instanceof Error ? err.message : t('secrets.error.load'))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "loader-dep", snippet: "useCallback(async () => { setLoadingPlugins(true); setPluginStatusMessage(\"\"); try { const res = await apiClient(\"/api/plugins/preferences\"); const data = await res.json().catch(() => ({})); if (!res.ok) { throw new Error(data?.error || t(\"settings.pluginsLoadFailed\")); } const entries = Array.isArray(data?.plugins) ? data.plugins : []; setPlugins(entries); } catch (error) { setPluginStatusMessage(error instanceof Error ? error.message : t(\"settings.pluginsLoadFailed\")); setPlugins([]); } finally { setLoadingPlugins(false); } }, [t])", reason: LOADER_DEP_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPluginStatusMessage(error instanceof Error ? error.message : t(\"settings.pluginsLoadFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "loader-dep", snippet: "useCallback(async () => { setLoadingConnectors(true); setConnectorStatusMessage(\"\"); try { setConnectors(await fetchUserConnectors()); } catch (error) { setConnectorStatusMessage(error instanceof Error ? error.message : t(\"settings.connectorsLoadFailed\")); setConnectors([]); } finally { setLoadingConnectors(false); } }, [t])", reason: LOADER_DEP_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setConnectorStatusMessage(error instanceof Error ? error.message : t(\"settings.connectorsLoadFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPluginStatusMessage(t(\"settings.pluginsUpdated\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPluginStatusMessage(error instanceof Error ? error.message : t(\"settings.pluginsUpdateFailed\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setAgentFormError(t(\"settings.error.agentNameRequired\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setAgentFormError(err instanceof Error ? err.message : t(\"settings.error.createAgent\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setAgentFormError(t(\"settings.networkError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setProfileMsg(t(\"settings.displayNameEmpty\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setProfileMsg(t(\"settings.profileUpdated\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setProfileMsg(t(\"settings.networkError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPasswordMsg(t(\"settings.allFieldsRequired\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPasswordMsg(t(\"settings.passwordsNotMatch\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPasswordMsg(t(\"settings.passwordMinLength\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPasswordMsg(t(\"settings.passwordChanged\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/SettingsPage.tsx", kind: "eager-translate", snippet: "setPasswordMsg(t(\"settings.networkError\"))", reason: EAGER_TRANSLATE_REASON },
  { file: "pages/UserConnectionsPage.tsx", kind: "eager-translate", snippet: "setRuntimeError( error instanceof Error ? error.message : t(\"userConnections.error.disconnect\"), )", reason: EAGER_TRANSLATE_REASON },
];
