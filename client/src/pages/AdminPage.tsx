import { safeHtml } from "../utils/sanitize";
/**
 * AdminPage — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 * Updated 2026-02-20: i18n + theme support
 */
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useAgentStore } from "../stores/agentStore";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import { SensitiveTokenCard } from "../components/ui/SensitiveTokenCard";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
} from "../components/ui/primitives";
import { activeStateBadgeVariant } from "../utils/statusBadges";

const API = import.meta.env.VITE_API_URL ?? "/api";

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

const USERS_PAGE_SIZE = 12;

export const AdminPage: React.FC = () => {
  const { token } = useAuthStore();
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<"users" | "invites" | "byoa">("invites");
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);

  // BYOA form state
  const [agentName, setAgentName] = useState("");
  const [agentWebhook, setAgentWebhook] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [agentColor, setAgentColor] = useState("#888888");
  const [agentTrustLevel, setAgentTrustLevel] = useState<"standard" | "elevated">("standard");
  const [agentReceiveMode, setAgentReceiveMode] = useState<"mentions" | "all">("mentions");
  const [agentDelivery, setAgentDelivery] = useState<"sse" | "webhook" | "openclaw-inject">("sse");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New invite form state
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState<number | "">("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const fetchUsers = useCallback(async (page = 1) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(USERS_PAGE_SIZE));
      params.set("page", String(page));
      const res = await fetch(`${API}/admin/users?${params.toString()}`, { headers });
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
  }, [token, t, navigate]);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/invite-codes`, { headers });
      if (res.status === 403) {
        navigate("/");
        return;
      }
      const data = await res.json();
      setCodes(data.codes ?? []);
    } catch {
      setError(t("admin.error.loadInvites"));
    }
  }, [token, t, navigate]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agents`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data ?? []);
    } catch {
      /* silent */
    }
  }, [token]);

  const createAgent = async () => {
    if (!agentName.trim()) return;
    setCreatingAgent(true);
    setNewAgentToken(null);
    try {
      const res = await fetch(`${API}/agents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: agentName.trim(),
          ...(agentWebhook.trim() ? { webhookUrl: agentWebhook.trim() } : {}),
          description: agentDesc.trim(),
          emoji: agentEmoji,
          color: agentColor,
          trustLevel: agentTrustLevel,
          receiveMode: agentReceiveMode,
          delivery: agentDelivery,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewAgentToken(data.token);
        setAgentName("");
        setAgentWebhook("");
        setAgentDesc("");
        setAgentEmoji("🤖");
        setAgentColor("#888888");
        setAgentTrustLevel("standard");
        setAgentReceiveMode("mentions");
        setAgentDelivery("sse");
        fetchAgents();
      } else {
        alert(data.error || `Failed to create agent (${res.status})`);
      }
    } catch (err: any) {
      alert(err.message || "Failed to create agent");
    } finally {
      setCreatingAgent(false);
    }
  };

  const toggleAgent = async (agentId: string, current: boolean) => {
    await fetch(`${API}/agents/${agentId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ isActive: !current }),
    });
    fetchAgents();
  };

  const deleteAgent = async (agentId: string) => {
    setAgentToDelete(agentId);
  };

  const confirmDeleteAgent = async () => {
    if (!agentToDelete) return;
    setIsDeletingAgent(true);
    try {
      await fetch(`${API}/agents/${agentToDelete}`, {
        method: "DELETE",
        headers,
      });
      fetchAgents();
    } finally {
      setIsDeletingAgent(false);
      setAgentToDelete(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(1), fetchCodes(), fetchAgents()]);
      setLoading(false);
    };
    load();
  }, [fetchUsers, fetchCodes, fetchAgents]);

  const toggleAITrigger = async (username: string, current: boolean) => {
    try {
      await fetch(`${API}/admin/users/${username}/ai-trigger`, {
        method: "PATCH",
        headers,
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
      const res = await fetch(`${API}/admin/invite-codes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          maxUses,
          expiresInDays: expiresInDays || undefined,
        }),
      });
      const data = await res.json();
      if (data.invite) setCodes((c) => [data.invite, ...c]);
    } catch {
      setError(t("admin.error.createCode"));
    }
    setCreating(false);
  };

  const deleteCode = async (code: string) => {
    try {
      await fetch(`${API}/admin/invite-codes/${code}`, {
        method: "DELETE",
        headers,
      });
      setCodes((c) => c.filter((x) => x.code !== code));
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

  const usersPageStart =
    userTotalCount === 0 ? 0 : (userPage - 1) * USERS_PAGE_SIZE + 1;
  const usersPageEnd = userTotalCount === 0 ? 0 : usersPageStart + users.length - 1;
  const userResultsText = t("pagination.results")
    .replace("{start}", String(usersPageStart))
    .replace("{end}", String(usersPageEnd))
    .replace("{total}", String(userTotalCount));
  const userPageInfoText = t("pagination.pageInfo")
    .replace("{page}", String(Math.min(userPage, userTotalPages)))
    .replace("{total}", String(Math.max(1, userTotalPages)));

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
      title={<span className="inline-flex items-center gap-2">🔧 {t("admin.title")}</span>}
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
        <Card tone="muted" className="p-3 sm:p-4">
          <div className="flex gap-2 flex-wrap">
            {(["invites", "users", "byoa"] as const).map((tabKey) => (
              <Button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                variant={tab === tabKey ? "primary" : "secondary"}
                size="sm"
              >
                {t(`admin.tab.${tabKey}`)}
              </Button>
            ))}
          </div>
        </Card>

        {/* Invite Codes Tab */}
        {tab === "invites" && (
          <div className="space-y-4 sm:space-y-5">
            {/* Create New */}
            <Card className="p-3 sm:p-4">
              <SectionHeader title={t("admin.invites.create")} className="mb-3" />
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
                <Button
                  onClick={createCode}
                  disabled={creating}
                  size="sm"
                >
                  {creating
                    ? t("admin.invites.creating")
                    : t("admin.invites.generate")}
                </Button>
              </div>
            </Card>

            {/* Code List */}
            <div className="space-y-2">
              {codes.length === 0 ? (
                <EmptyState icon="🎟️" title={t("admin.invites.none")} />
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
                            : "bg-gray-50 border-gray-200 opacity-60"
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
                          className={`text-xs hidden sm:block ${isDark ? "text-gray-500" : "text-gray-500"}`}
                        >
                          {t("admin.invites.expiresDate")}{" "}
                          {new Date(c.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {/* Actions */}
                      <div className="flex gap-2 sm:ml-auto w-full sm:w-auto justify-end">
                        {active && (
                          <Button
                            onClick={() => copyCode(getShareUrl(c.code), c.code)}
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
                          🗑
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
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
              <EmptyState icon="👥" title={t("admin.users.none")} />
            )}
            {users.map((u) => (
              <Card key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                    isDark ? "bg-gray-700" : "bg-gray-200"
                  }`}
                >
                  {u.userType === "HUMAN" ? "👨‍💻" : useAgentStore.getState().getAgentEmoji(u.id, u.userType) || "🤖"}
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
                    onClick={() => toggleAITrigger(u.username, u.canTriggerAI)}
                    size="sm"
                    variant={u.canTriggerAI ? "primary" : "secondary"}
                    className="w-full sm:w-auto justify-center"
                  >
                    <span>{u.canTriggerAI ? "✅" : "🚫"}</span>
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
                <div className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>
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
            {/* Create Agent */}
            <Card className="p-3 sm:p-4">
              <SectionHeader title={t("admin.byoa.register")} className="mb-3" />
              <div
                className={`mb-3 p-3 rounded-lg text-xs border ${
                  isDark
                    ? "bg-blue-900/20 border-blue-700/40 text-blue-200"
                    : "bg-blue-50 border-blue-200 text-blue-800"
                }`}
              >
                ℹ️{" "}
                <span
                  dangerouslySetInnerHTML={safeHtml(t("admin.byoa.betaInfo"))}
                />
              </div>
              <div className="space-y-3">
                <Input
                  placeholder={t("admin.byoa.agentName")}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
                <Input
                  placeholder={t("admin.byoa.webhookUrlOptional")}
                  value={agentWebhook}
                  onChange={(e) => setAgentWebhook(e.target.value)}
                />
                <Input
                  placeholder={t("admin.byoa.description")}
                  value={agentDesc}
                  onChange={(e) => setAgentDesc(e.target.value)}
                />

                {/* Extended config */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{t("admin.byoa.emoji")}</label>
                    <Input
                      placeholder="🤖"
                      value={agentEmoji}
                      onChange={(e) => setAgentEmoji(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("admin.byoa.color") }</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={agentColor}
                        onChange={(e) => setAgentColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0"
                      />
                      <Input
                        placeholder="#888888"
                        value={agentColor}
                        onChange={(e) => setAgentColor(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("admin.byoa.trustLevel") }</label>
                    <select
                      value={agentTrustLevel}
                      onChange={(e) => setAgentTrustLevel(e.target.value as "standard" | "elevated")}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${
                        isDark
                          ? "bg-gray-800 border-gray-600 text-white"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="standard">{ t("admin.byoa.trustStandard") }</option>
                      <option value="elevated">{ t("admin.byoa.trustElevated") }</option>
                    </select>
                  </div>
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("admin.byoa.receive") }</label>
                    <select
                      value={agentReceiveMode}
                      onChange={(e) => setAgentReceiveMode(e.target.value as "mentions" | "all")}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${
                        isDark
                          ? "bg-gray-800 border-gray-600 text-white"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="mentions">{ t("admin.byoa.receiveMentions") }</option>
                      <option value="all">{ t("admin.byoa.receiveAll") }</option>
                    </select>
                  </div>
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("admin.byoa.delivery") }</label>
                    <select
                      value={agentDelivery}
                      onChange={(e) => setAgentDelivery(e.target.value as "sse" | "webhook" | "openclaw-inject")}
                      className={`w-full rounded-lg border px-3 py-2 text-sm ${
                        isDark
                          ? "bg-gray-800 border-gray-600 text-white"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="sse">SSE + REST</option>
                      <option value="webhook">{ t("admin.byoa.deliveryWebhook") }</option>
                      <option value="openclaw-inject">{ t("admin.byoa.deliveryInject") }</option>
                    </select>
                  </div>
                </div>

                <Button
                  onClick={createAgent}
                  disabled={
                    creatingAgent || !agentName.trim()
                  }
                >
                  {creatingAgent
                    ? t("admin.byoa.creating")
                    : t("admin.byoa.create")}
                </Button>
              </div>

              {/* One-time token display */}
              {newAgentToken && (
                <SensitiveTokenCard
                  warning={t("admin.byoa.tokenWarning")}
                  description={<span dangerouslySetInnerHTML={safeHtml(t("admin.byoa.pendingActivate"))} />}
                  token={newAgentToken}
                  copyLabel={t("admin.byoa.copy")}
                  copiedLabel={t("admin.byoa.copied")}
                  copied={copiedToken}
                  onCopy={() => {
                    navigator.clipboard.writeText(newAgentToken);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                  className="mt-4"
                  footer={(
                    <>
                      {t("admin.byoa.useAs")}{" "}
                      <code className={isDark ? "text-gray-300" : "text-gray-800"}>
                        Authorization: Bearer {newAgentToken.slice(0, 20)}…
                      </code>
                    </>
                  )}
                />
              )}
            </Card>

            {/* Agent List */}
            <Card className="p-3 sm:p-4">
              <SectionHeader
                title={`${t("admin.byoa.list")} (${agents.length})`}
                className="mb-3"
              />
              {agents.length === 0 ? (
                <EmptyState icon="🤖" title={t("admin.byoa.none")} />
              ) : (
                <div className="space-y-3">
                  {agents.map((agent) => (
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
                          <Badge variant={activeStateBadgeVariant(agent.isActive)}>
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
                          onClick={() => toggleAgent(agent.id, agent.isActive)}
                          size="sm"
                          variant="secondary"
                        >
                          {agent.isActive
                            ? t("admin.byoa.suspend")
                            : t("admin.byoa.activate")}
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
                  ))}
                </div>
              )}
            </Card>

            {/* Setup Guide */}
            <Card className="p-3 sm:p-4">
              <SectionHeader title={t("admin.byoa.setupGuide")} className="mb-3" />
              <div
                className={`space-y-3 text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                <p>{t("admin.byoa.step1")}</p>
                <p>{t("admin.byoa.step2")}</p>
                <p>
                  {t("admin.byoa.step3")}{" "}
                  <code
                    className={`px-1 rounded ${
                      isDark
                        ? "text-gray-200 bg-gray-700"
                        : "text-gray-900 bg-gray-200"
                    }`}
                  >
                    /api/agents/message
                  </code>
                  :
                </p>
                <pre
                  className={`rounded-lg p-3 text-xs overflow-x-auto ${
                    isDark
                      ? "bg-gray-900 text-gray-300"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >{`POST /api/agents/message
Authorization: Bearer byoa_<your-token>
Content-Type: application/json

{
  "roomId": "<room-id>",
  "content": "Hello from my agent!"
}`}</pre>
                <p>{t("admin.byoa.step4")}</p>
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
