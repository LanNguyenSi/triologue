/**
 * AdminPage — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 * Updated 2026-02-20: i18n + theme support
 */
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  TicketIcon,
  UserGroupIcon,
  CpuChipIcon,
  Cog6ToothIcon,
  TrashIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useAgentStore } from "../stores/agentStore";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
} from "../components/ui/primitives";
import { activeStateBadgeVariant } from "../utils/statusBadges";
import { apiClient } from "../lib/apiClient";

interface User {
  id: string;
  username: string;
  displayName: string;
  userType: string;
  isAdmin: boolean;
  canTriggerAI: boolean;
  isActive: boolean;
  createdAt: string;
}

interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  mentionKey: string;
  webhookUrl: string;
  description?: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  agentUser: {
    id: string;
    username: string;
    participations: { room: { id: string; name: string } }[];
  };
}

interface UserListResponse {
  users?: User[];
  items?: User[];
  totalCount?: number;
  pageInfo?: {
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
  };
}

interface InviteCodeListResponse {
  codes?: InviteCode[];
  items?: InviteCode[];
  totalCount?: number;
  pageInfo?: {
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
  };
}

interface AgentListResponse {
  agents?: Agent[];
  items?: Agent[];
  totalCount?: number;
  pageInfo?: {
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
  };
}

const USERS_PAGE_SIZE = 12;
const INVITES_PAGE_SIZE = 12;
const AGENTS_PAGE_SIZE = 12;

export const AdminPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [users, setUsers] = useState<User[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalCount, setUserTotalCount] = useState(0);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userHasMore, setUserHasMore] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [invitePage, setInvitePage] = useState(1);
  const [inviteTotalCount, setInviteTotalCount] = useState(0);
  const [inviteTotalPages, setInviteTotalPages] = useState(1);
  const [inviteHasMore, setInviteHasMore] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentPage, setAgentPage] = useState(1);
  const [agentTotalCount, setAgentTotalCount] = useState(0);
  const [agentTotalPages, setAgentTotalPages] = useState(1);
  const [agentHasMore, setAgentHasMore] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [tab, setTab] = useState<"users" | "invites" | "byoa">("invites");
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New invite form state
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState<number | "">("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchUsers = useCallback(
    async (page = 1) => {
      setUsersLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(USERS_PAGE_SIZE));
        params.set("page", String(page));
        const res = await apiClient(`/api/admin/users?${params.toString()}`);
        if (res.status === 403) {
          navigate("/");
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load users (${res.status})`);
        }
        const data = await res.json();
        const payload = data as UserListResponse;
        const items = payload.items ?? payload.users ?? [];
        const totalCount = payload.totalCount ?? items.length;
        const totalPages =
          payload.pageInfo?.totalPages ??
          Math.max(1, Math.ceil(totalCount / USERS_PAGE_SIZE));
        const currentPage = payload.pageInfo?.page ?? page;

        setUsers(items);
        setUserTotalCount(totalCount);
        setUserPage(currentPage);
        setUserTotalPages(totalPages);
        setUserHasMore(payload.pageInfo?.hasMore ?? currentPage < totalPages);
      } catch {
        setError(t("admin.error.loadUsers"));
        setUsers([]);
        setUserTotalCount(0);
        setUserPage(1);
        setUserTotalPages(1);
        setUserHasMore(false);
      } finally {
        setUsersLoading(false);
      }
    },
    [t, navigate],
  );

  const fetchCodes = useCallback(
    async (page = 1) => {
      setInvitesLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(INVITES_PAGE_SIZE));
        params.set("page", String(page));
        const res = await apiClient(`/api/admin/invite-codes?${params.toString()}`);
        if (res.status === 403) {
          navigate("/");
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load invite codes (${res.status})`);
        }
        const data = await res.json();
        const payload = data as InviteCodeListResponse;
        const items = payload.items ?? payload.codes ?? [];
        const totalCount = payload.totalCount ?? items.length;
        const totalPages =
          payload.pageInfo?.totalPages ??
          Math.max(1, Math.ceil(totalCount / INVITES_PAGE_SIZE));
        const currentPage = payload.pageInfo?.page ?? page;

        setCodes(items);
        setInviteTotalCount(totalCount);
        setInvitePage(currentPage);
        setInviteTotalPages(totalPages);
        setInviteHasMore(payload.pageInfo?.hasMore ?? currentPage < totalPages);
      } catch {
        setError(t("admin.error.loadInvites"));
        setCodes([]);
        setInviteTotalCount(0);
        setInvitePage(1);
        setInviteTotalPages(1);
        setInviteHasMore(false);
      } finally {
        setInvitesLoading(false);
      }
    },
    [t, navigate],
  );

  const fetchAgents = useCallback(
    async (page = 1) => {
      setAgentsLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(AGENTS_PAGE_SIZE));
        params.set("page", String(page));
        const res = await apiClient(`/api/agents?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to load agents (${res.status})`);
        }
        const data = await res.json();
        const payload = data as AgentListResponse | Agent[];
        const items = Array.isArray(payload)
          ? payload
          : (payload.items ?? payload.agents ?? []);
        const totalCount = Array.isArray(payload)
          ? items.length
          : (payload.totalCount ?? items.length);
        const totalPages = Array.isArray(payload)
          ? Math.max(1, Math.ceil(totalCount / AGENTS_PAGE_SIZE))
          : (payload.pageInfo?.totalPages ??
            Math.max(1, Math.ceil(totalCount / AGENTS_PAGE_SIZE)));
        const currentPage = Array.isArray(payload)
          ? page
          : (payload.pageInfo?.page ?? page);

        setAgents(items);
        setAgentTotalCount(totalCount);
        setAgentPage(currentPage);
        setAgentTotalPages(totalPages);
        setAgentHasMore(
          Array.isArray(payload)
            ? currentPage < totalPages
            : (payload.pageInfo?.hasMore ?? currentPage < totalPages),
        );
      } catch {
        setAgents([]);
        setAgentTotalCount(0);
        setAgentPage(1);
        setAgentTotalPages(1);
        setAgentHasMore(false);
      } finally {
        setAgentsLoading(false);
      }
    },
    [],
  );

  const toggleAgent = async (agentId: string, current: boolean) => {
    await apiClient(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !current }),
    });
    await fetchAgents(agentPage);
  };

  const deleteAgent = async (agentId: string) => {
    setAgentToDelete(agentId);
  };

  const confirmDeleteAgent = async () => {
    if (!agentToDelete) return;
    setIsDeletingAgent(true);
    try {
      await apiClient(`/api/agents/${agentToDelete}`, {
        method: "DELETE",
      });
      const nextPage =
        agents.length === 1 && agentPage > 1 ? agentPage - 1 : agentPage;
      await fetchAgents(nextPage);
    } finally {
      setIsDeletingAgent(false);
      setAgentToDelete(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(1), fetchCodes(1), fetchAgents(1)]);
      setLoading(false);
    };
    load();
  }, [fetchUsers, fetchCodes, fetchAgents]);

  const toggleAITrigger = async (username: string, current: boolean) => {
    try {
      await apiClient(`/api/admin/users/${username}/ai-trigger`, {
        method: "PATCH",
        body: JSON.stringify({ canTriggerAI: !current }),
      });
      setUsers((u) =>
        u.map((x) =>
          x.username === username ? { ...x, canTriggerAI: !current } : x,
        ),
      );
    } catch {
      setError(t("admin.error.updateUser"));
    }
  };

  const createCode = async () => {
    setCreating(true);
    try {
      const res = await apiClient(`/api/admin/invite-codes`, {
        method: "POST",
        body: JSON.stringify({
          maxUses,
          expiresInDays: expiresInDays || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create invite code (${res.status})`);
      }
      await fetchCodes(1);
    } catch {
      setError(t("admin.error.createCode"));
    }
    setCreating(false);
  };

  const deleteCode = async (code: string) => {
    try {
      await apiClient(`/api/admin/invite-codes/${code}`, {
        method: "DELETE",
      });
      const nextPage =
        codes.length === 1 && invitePage > 1 ? invitePage - 1 : invitePage;
      await fetchCodes(nextPage);
    } catch {
      setError(t("admin.error.deleteCode"));
    }
  };

  const copyCode = (value: string, copiedId: string) => {
    navigator.clipboard.writeText(value);
    setCopied(copiedId);
    setTimeout(() => setCopied(null), 2000);
  };

  const getShareUrl = (code: string) =>
    `${window.location.origin}/register?invite=${code}`;

  const handleUsersNextPage = async () => {
    if (!userHasMore || usersLoading) return;
    await fetchUsers(userPage + 1);
  };

  const handleUsersPrevPage = async () => {
    if (userPage <= 1 || usersLoading) return;
    await fetchUsers(userPage - 1);
  };

  const handleInvitesNextPage = async () => {
    if (!inviteHasMore || invitesLoading) return;
    await fetchCodes(invitePage + 1);
  };

  const handleInvitesPrevPage = async () => {
    if (invitePage <= 1 || invitesLoading) return;
    await fetchCodes(invitePage - 1);
  };

  const handleAgentsNextPage = async () => {
    if (!agentHasMore || agentsLoading) return;
    await fetchAgents(agentPage + 1);
  };

  const handleAgentsPrevPage = async () => {
    if (agentPage <= 1 || agentsLoading) return;
    await fetchAgents(agentPage - 1);
  };

  const usersPageStart =
    userTotalCount === 0 ? 0 : (userPage - 1) * USERS_PAGE_SIZE + 1;
  const usersPageEnd =
    userTotalCount === 0 ? 0 : usersPageStart + users.length - 1;
  const userResultsText = t("pagination.results")
    .replace("{start}", String(usersPageStart))
    .replace("{end}", String(usersPageEnd))
    .replace("{total}", String(userTotalCount));
  const userPageInfoText = t("pagination.pageInfo")
    .replace("{page}", String(Math.min(userPage, userTotalPages)))
    .replace("{total}", String(Math.max(1, userTotalPages)));
  const invitesPageStart =
    inviteTotalCount === 0 ? 0 : (invitePage - 1) * INVITES_PAGE_SIZE + 1;
  const invitesPageEnd =
    inviteTotalCount === 0 ? 0 : invitesPageStart + codes.length - 1;
  const inviteResultsText = t("pagination.results")
    .replace("{start}", String(invitesPageStart))
    .replace("{end}", String(invitesPageEnd))
    .replace("{total}", String(inviteTotalCount));
  const invitePageInfoText = t("pagination.pageInfo")
    .replace("{page}", String(Math.min(invitePage, inviteTotalPages)))
    .replace("{total}", String(Math.max(1, inviteTotalPages)));
  const agentsPageStart =
    agentTotalCount === 0 ? 0 : (agentPage - 1) * AGENTS_PAGE_SIZE + 1;
  const agentsPageEnd =
    agentTotalCount === 0 ? 0 : agentsPageStart + agents.length - 1;
  const agentResultsText = t("pagination.results")
    .replace("{start}", String(agentsPageStart))
    .replace("{end}", String(agentsPageEnd))
    .replace("{total}", String(agentTotalCount));
  const agentPageInfoText = t("pagination.pageInfo")
    .replace("{page}", String(Math.min(agentPage, agentTotalPages)))
    .replace("{total}", String(Math.max(1, agentTotalPages)));

  if (loading) {
    return (
      <PageShell maxWidth="6xl">
        <div className="flex items-center justify-center h-32">
          {t("admin.loading")}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      maxWidth="6xl"
      title={t("admin.title")}
      subtitle={t("admin.subtitle")}
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div
            className={`p-3 rounded-lg text-sm border ${
              isDark
                ? "bg-red-900/40 border-red-700/60 text-red-200"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {error}
          </div>
        )}

        {/* Tabs */}
        <Card tone="muted" className="p-1.5 sm:p-2">
          <div
            role="tablist"
            aria-label={t("admin.title")}
            className={`flex flex-wrap gap-1 border-b px-1 ${isDark ? "border-gray-700/50" : "border-gray-200/60"}`}
          >
            {(["invites", "users", "byoa"] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={tab === tabKey}
                onClick={() => setTab(tabKey)}
                className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                  tab === tabKey
                    ? isDark
                      ? "border-blue-400 text-blue-300 bg-gray-800"
                      : "border-blue-600 text-blue-700 bg-white"
                    : isDark
                      ? "border-transparent text-gray-300 hover:text-white hover:bg-gray-800/70"
                      : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {t(`admin.tab.${tabKey}`)}
              </button>
            ))}
          </div>
        </Card>

        {/* Invite Codes Tab */}
        {tab === "invites" && (
          <div className="space-y-4 sm:space-y-5">
            {/* Create New */}
            <Card className="p-3 sm:p-4">
              <SectionHeader
                title={t("admin.invites.create")}
                className="mb-3"
              />
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("admin.invites.maxUses")}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(Number(e.target.value))}
                    className="w-24 sm:w-28 py-1.5"
                  />
                </div>
                <div>
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("admin.invites.expires")}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    placeholder={t("admin.invites.never")}
                    value={expiresInDays}
                    onChange={(e) =>
                      setExpiresInDays(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    className="w-24 sm:w-28 py-1.5"
                  />
                </div>
                <Button onClick={createCode} disabled={creating} size="sm">
                  {creating
                    ? t("admin.invites.creating")
                    : t("admin.invites.generate")}
                </Button>
              </div>
            </Card>

            {/* Code List */}
            <div className="space-y-2">
              {invitesLoading && (
                <Card tone="muted" className="p-3 text-sm">
                  {t("admin.loading")}
                </Card>
              )}
              {!invitesLoading && codes.length === 0 ? (
                <EmptyState icon={<TicketIcon className="w-8 h-8" />} title={t("admin.invites.none")} />
              ) : (
                codes.map((c) => {
                  const expired =
                    c.expiresAt && new Date(c.expiresAt) < new Date();
                  const exhausted = c.useCount >= c.maxUses;
                  const active = !expired && !exhausted;
                  return (
                    <Card
                      key={c.id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 ${
                        active
                          ? ""
                          : isDark
                            ? "bg-gray-800/50 border-gray-700/50 opacity-60"
                            : "bg-gray-50 border-gray-200/60 opacity-60"
                      }`}
                    >
                      {/* Code */}
                      <span
                        className={`font-mono font-bold text-sm tracking-wider sm:min-w-[7rem] flex-shrink-0 ${
                          isDark ? "text-blue-300" : "text-blue-700"
                        }`}
                      >
                        {c.code}
                      </span>
                      {/* Status */}
                      <Badge
                        variant={
                          active ? "success" : expired ? "danger" : "neutral"
                        }
                        className="flex-shrink-0"
                      >
                        {expired
                          ? t("admin.invites.expired")
                          : exhausted
                            ? t("admin.invites.usedUp")
                            : t("admin.invites.active")}
                      </Badge>
                      {/* Uses */}
                      <span
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                      >
                        {c.useCount}/{c.maxUses} {t("admin.invites.uses")}
                      </span>
                      {/* Expiry */}
                      {c.expiresAt && (
                        <span
                          className="text-xs hidden sm:block text-gray-500 dark:text-gray-400"
                        >
                          {t("admin.invites.expiresDate")}{" "}
                          {new Date(c.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {/* Actions */}
                      <div className="flex gap-2 sm:ml-auto w-full sm:w-auto justify-end">
                        {active && (
                          <Button
                            onClick={() =>
                              copyCode(getShareUrl(c.code), c.code)
                            }
                            size="sm"
                            variant="secondary"
                          >
                            {copied === c.code
                              ? t("admin.invites.copied")
                              : t("admin.invites.copyLink")}
                          </Button>
                        )}
                        <Button
                          onClick={() => deleteCode(c.code)}
                          size="sm"
                          variant="danger"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
            <Card tone="muted" className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {inviteResultsText}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleInvitesPrevPage}
                    disabled={invitePage <= 1 || invitesLoading}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <span
                    className={`text-sm min-w-[90px] text-center ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {invitePageInfoText}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleInvitesNextPage}
                    disabled={!inviteHasMore || invitesLoading}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Users Tab */}
        {tab === "users" && (
          <div className="space-y-4 sm:space-y-5">
            <div className="space-y-2">
              {usersLoading && (
                <Card tone="muted" className="p-3 text-sm">
                  {t("admin.loading")}
                </Card>
              )}
              {!usersLoading && users.length === 0 && (
                <EmptyState icon={<UserGroupIcon className="w-8 h-8" />} title={t("admin.users.none")} />
              )}
              {users.map((u) => (
                <Card
                  key={u.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                      isDark ? "bg-gray-700" : "bg-gray-200"
                    }`}
                  >
                    {u.userType === "HUMAN"
                      ? <UserIcon className="w-4 h-4" />
                      : useAgentStore
                          .getState()
                          .getAgentEmoji(u.id, u.userType) || <CpuChipIcon className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {u.displayName}
                      {u.isAdmin && (
                        <Badge variant="warning">
                          {t("admin.users.admin")}
                        </Badge>
                      )}
                    </div>
                    <div
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      @{u.username} · {u.userType}
                    </div>
                  </div>
                  {/* canTriggerAI toggle */}
                  {u.userType === "HUMAN" && (
                    <Button
                      onClick={() =>
                        toggleAITrigger(u.username, u.canTriggerAI)
                      }
                      size="sm"
                      variant={u.canTriggerAI ? "primary" : "secondary"}
                      className="w-full sm:w-auto justify-center"
                    >
                      <span>{u.canTriggerAI ? "\u2713" : "\u2715"}</span>
                      <span>
                        {t("admin.users.aiTrigger")}{" "}
                        {u.canTriggerAI
                          ? t("admin.users.aiOn")
                          : t("admin.users.aiOff")}
                      </span>
                    </Button>
                  )}
                </Card>
              ))}
            </div>
            <Card tone="muted" className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {userResultsText}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleUsersPrevPage}
                    disabled={userPage <= 1 || usersLoading}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <span
                    className={`text-sm min-w-[90px] text-center ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {userPageInfoText}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleUsersNextPage}
                    disabled={!userHasMore || usersLoading}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* BYOA Agents Tab */}
        {tab === "byoa" && (
          <div className="space-y-4 sm:space-y-5">
            {/* Agent List */}
            <Card className="p-3 sm:p-4">
              <SectionHeader
                title={`${t("admin.byoa.list")} (${agentTotalCount})`}
                className="mb-3"
              />
              {agentsLoading && (
                <Card tone="muted" className="p-3 text-sm">
                  {t("admin.loading")}
                </Card>
              )}
              {!agentsLoading && agents.length === 0 ? (
                <EmptyState icon={<CpuChipIcon className="w-8 h-8" />} title={t("admin.byoa.none")} />
              ) : (
                <div className="space-y-3">
                  {agents.map((agent) => {
                    const toggleLabel = agent.isActive
                      ? t("admin.byoa.suspend")
                      : t("admin.byoa.activate");
                    return (
                      <Card
                        key={agent.id}
                        tone="muted"
                        className="flex flex-col sm:flex-row sm:items-start gap-3 p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}
                            >
                              {agent.name}
                            </span>
                            <code
                              className={`text-xs px-1.5 rounded ${
                                isDark
                                  ? "text-indigo-300 bg-indigo-900/30"
                                  : "text-indigo-700 bg-indigo-100"
                              }`}
                            >
                              @{agent.mentionKey}
                            </code>
                            <Badge
                              variant={activeStateBadgeVariant(agent.isActive)}
                            >
                              {agent.isActive
                                ? t("admin.byoa.active")
                                : t("admin.byoa.pending")}
                            </Badge>
                          </div>
                          <div
                            className={`text-xs mt-0.5 truncate ${isDark ? "text-gray-400" : "text-gray-600"}`}
                          >
                            {agent.webhookUrl}
                          </div>
                          {agent.agentUser.participations.length > 0 && (
                            <div
                              className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-600"}`}
                            >
                              {t("admin.byoa.rooms")}{" "}
                              {agent.agentUser.participations
                                .map((p) => p.room.name)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0 w-full sm:w-auto justify-end">
                          <Button
                            onClick={() =>
                              navigate(`/admin/agents/${agent.id}/config`)
                            }
                            size="sm"
                            variant="secondary"
                          >
                            <Cog6ToothIcon className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() =>
                              toggleAgent(agent.id, agent.isActive)
                            }
                            size="sm"
                            variant="secondary"
                          >
                            {toggleLabel}
                          </Button>
                          <Button
                            onClick={() => deleteAgent(agent.id)}
                            size="sm"
                            variant="danger"
                          >
                            {t("admin.byoa.delete")}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card tone="muted" className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div
                  className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {agentResultsText}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAgentsPrevPage}
                    disabled={agentPage <= 1 || agentsLoading}
                  >
                    {t("pagination.prev")}
                  </Button>
                  <span
                    className={`text-sm min-w-[90px] text-center ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {agentPageInfoText}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAgentsNextPage}
                    disabled={!agentHasMore || agentsLoading}
                  >
                    {t("pagination.next")}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        <ConfirmDialog
          open={!!agentToDelete}
          title={t("admin.byoa.deleteTitle")}
          message={t("admin.byoa.deleteConfirm")}
          confirmLabel={t("chat.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          loading={isDeletingAgent}
          onConfirm={confirmDeleteAgent}
          onCancel={() => setAgentToDelete(null)}
        />
      </div>
    </PageShell>
  );
};
