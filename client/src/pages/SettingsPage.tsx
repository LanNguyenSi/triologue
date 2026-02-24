import { safeHtml } from "../utils/sanitize";
import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import {
  Badge,
  Button,
  Card,
  Input,
  SectionHeader,
  Select,
} from "../components/ui/primitives";

interface MyAgent {
  id: string;
  name: string;
  mentionKey: string;
  webhookUrl: string;
  description?: string;
  isActive: boolean;
  visibility?: string;
  sharedWith?: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

type SettingsTab = "preferences" | "profile" | "agents" | "danger";

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);

  // BYOA state
  const [agents, setAgents] = useState<MyAgent[]>([]);
  const [agentName, setAgentName] = useState("");
  const [agentWebhook, setAgentWebhook] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [agentColor, setAgentColor] = useState("#888888");
  const [agentRoomId, setAgentRoomId] = useState("");
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences");

  const token = () => localStorage.getItem("triologue_token");
  const authHeaders = () => ({
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  });

  // BYOA: fetch user's agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/mine", { headers: authHeaders() });
      if (res.ok) setAgents(await res.json());
    } catch {
      /* silent */
    }
  }, []);

  // BYOA: fetch joinable rooms
  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms", { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.rooms ?? []);
        setRooms(list.map((r: any) => ({ id: r.id, name: r.name })));
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchRooms();
  }, [fetchAgents, fetchRooms]);

  const createAgent = async () => {
    if (!agentName.trim() || !agentWebhook.trim()) return;
    setCreatingAgent(true);
    setNewAgentToken(null);
    try {
      const body: Record<string, string> = {
        name: agentName.trim(),
        webhookUrl: agentWebhook.trim(),
        description: agentDesc.trim(),
        emoji: agentEmoji,
        color: agentColor,
      };
      if (agentRoomId) body.roomId = agentRoomId;
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setNewAgentToken(data.token);
        setAgentName("");
        setAgentWebhook("");
        setAgentDesc("");
        setAgentEmoji("🤖");
        setAgentColor("#888888");
        setAgentRoomId("");
        fetchAgents();
      }
    } catch {
      /* ignore */
    } finally {
      setCreatingAgent(false);
    }
  };

  const deleteAgent = async (agentId: string) => {
    setAgentToDelete(agentId);
  };

  const confirmDeleteAgent = async () => {
    if (!agentToDelete) return;
    setIsDeletingAgent(true);
    try {
      await fetch(`/api/agents/${agentToDelete}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      fetchAgents();
    } finally {
      setIsDeletingAgent(false);
      setAgentToDelete(null);
    }
  };

  const saveProfile = async () => {
    if (!displayName.trim())
      return setProfileMsg(t("settings.displayNameEmpty"));
    setIsSaving(true);
    setProfileMsg("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfileMsg(t("settings.profileUpdated"));
        // Update local auth store
        useAuthStore.setState((s) => ({
          user: s.user
            ? { ...s.user, displayName: data.user.displayName }
            : s.user,
        }));
      } else {
        setProfileMsg(`❌ ${data.error}`);
      }
    } catch {
      setProfileMsg(t("settings.networkError"));
    } finally {
      setIsSaving(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword)
      return setPasswordMsg(t("settings.allFieldsRequired"));
    if (newPassword !== confirmPassword)
      return setPasswordMsg(t("settings.passwordsNotMatch"));
    if (newPassword.length < 8)
      return setPasswordMsg(t("settings.passwordMinLength"));
    setIsSaving(true);
    setPasswordMsg("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg(t("settings.passwordChanged"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordMsg(`❌ ${data.error}`);
      }
    } catch {
      setPasswordMsg(t("settings.networkError"));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== user?.username) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) {
        logout();
        navigate("/");
      }
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const passwordLabels = [
    t("settings.currentPassword"),
    t("settings.newPassword"),
    t("settings.confirmNewPassword"),
  ];
  const isDark = theme === "dark";
  const settingTabs: Array<{ key: SettingsTab; label: string }> = [
    { key: "preferences", label: t("settings.preferences") },
    { key: "profile", label: t("settings.profile") },
    { key: "agents", label: t("settings.myAgents") },
  ];
  const dangerTab = { key: "danger" as const, label: t("settings.dangerZone") };

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">⚙️ {t("settings.title")}</span>}
    >
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">
        <Card tone="muted" className="p-2 sm:p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {settingTabs.map((entry) => (
                <Button
                  key={entry.key}
                  type="button"
                  size="sm"
                  variant={activeTab === entry.key ? "primary" : "secondary"}
                  onClick={() => setActiveTab(entry.key)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant={activeTab === dangerTab.key ? "danger" : "secondary"}
              onClick={() => setActiveTab(dangerTab.key)}
              className={
                activeTab === dangerTab.key
                  ? ""
                  : isDark
                    ? "text-red-300 hover:text-red-200"
                    : "text-red-700 hover:text-red-800"
              }
            >
              {dangerTab.label}
            </Button>
          </div>
        </Card>

        {activeTab === "preferences" && (
        <Card className="p-4 sm:p-6 space-y-4">
          <SectionHeader title={t("settings.preferences")} />

          <div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("settings.language")}
            </label>
            <p className={`text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.languageDesc")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => setLanguage("de")}
                variant={language === "de" ? "primary" : "secondary"}
                className="flex-1"
              >
                🇩🇪 Deutsch
              </Button>
              <Button
                type="button"
                onClick={() => setLanguage("en")}
                variant={language === "en" ? "primary" : "secondary"}
                className="flex-1"
              >
                🇬🇧 English
              </Button>
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("settings.theme")}
            </label>
            <p className={`text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.themeDesc")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => setTheme("dark")}
                variant={theme === "dark" ? "primary" : "secondary"}
                className="flex-1"
              >
                🌙 {t("settings.themeDark")}
              </Button>
              <Button
                type="button"
                onClick={() => setTheme("light")}
                variant={theme === "light" ? "primary" : "secondary"}
                className="flex-1"
              >
                ☀️ {t("settings.themeLight")}
              </Button>
            </div>
          </div>
        </Card>
        )}

        {activeTab === "profile" && (
        <Card className="p-4 sm:p-6 space-y-4">
          <SectionHeader title={t("settings.profile")} />
          <div>
            <label className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.username")}
            </label>
            <div
              className={`rounded-lg px-3 py-2 text-sm opacity-70 select-all ${
                isDark ? "text-white bg-gray-700" : "text-gray-900 bg-gray-100"
              }`}
            >
              @{user?.username}
            </div>
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.displayName")}
            </label>
            <Input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
            />
          </div>
          {profileMsg && <p className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{profileMsg}</p>}
          <Button onClick={saveProfile} disabled={isSaving}>
            {t("settings.saveProfile")}
          </Button>

          <SectionHeader title={t("settings.changePassword")} />
          {passwordLabels.map((label, i) => {
            const vals = [currentPassword, newPassword, confirmPassword];
            const setters = [setCurrentPassword, setNewPassword, setConfirmPassword];
            return (
              <div key={label}>
                <label className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{label}</label>
                <Input
                  type="password"
                  value={vals[i]}
                  onChange={(e) => setters[i](e.target.value)}
                />
              </div>
            );
          })}
          {passwordMsg && <p className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{passwordMsg}</p>}
          <Button onClick={changePassword} disabled={isSaving}>
            {t("settings.changePassword")}
          </Button>

          <Button
            block
            variant="secondary"
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            {t("settings.logout")}
          </Button>
        </Card>
        )}

        {activeTab === "agents" && (
        <Card className="p-4 sm:p-6 space-y-4">
          <SectionHeader title={t("settings.myAgents")} />
          <Link
            to="/byoa"
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              isDark
                ? "bg-indigo-950/30 border-indigo-800/50 hover:border-indigo-600"
                : "bg-indigo-50 border-indigo-200 hover:border-indigo-400"
            }`}
          >
            <span className="text-2xl">🤖</span>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${isDark ? "text-indigo-300" : "text-indigo-700"}`}>
                {t("settings.byoaBanner.title")}
              </div>
              <div className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                {t("settings.byoaBanner.desc")}
              </div>
            </div>
            <span className={`text-sm ${isDark ? "text-indigo-400" : "text-indigo-600"}`}>→</span>
          </Link>

          <div className="space-y-2">
            <Input
              type="text"
              placeholder={t("settings.agentName")}
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
            />
            <Input
              type="url"
              placeholder={t("settings.webhookUrl")}
              value={agentWebhook}
              onChange={(e) => setAgentWebhook(e.target.value)}
            />
            <Input
              type="text"
              placeholder={t("settings.descriptionOptional")}
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>Emoji</label>
                <Input
                  placeholder="🤖"
                  value={agentEmoji}
                  onChange={(e) => setAgentEmoji(e.target.value)}
                />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>Color</label>
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
            <Select value={agentRoomId} onChange={(e) => setAgentRoomId(e.target.value)}>
              <option value="">{t("settings.addToRoom")}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button
              onClick={createAgent}
              disabled={creatingAgent || !agentName.trim() || !agentWebhook.trim()}
            >
              {creatingAgent ? t("settings.creating") : t("settings.registerAgent")}
            </Button>
          </div>

          {newAgentToken && (
            <div
              className={`p-3 rounded-lg border space-y-2 ${
                isDark
                  ? "bg-yellow-900/30 border-yellow-600"
                  : "bg-yellow-50 border-yellow-300"
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  isDark ? "text-yellow-300" : "text-yellow-800"
                }`}
              >
                {t("settings.tokenWarning")}
              </p>
              <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-700"}`}>
                <span dangerouslySetInnerHTML={safeHtml(t("settings.pendingNotice"))} />
              </p>
              <div className="flex items-center gap-2">
                <code
                  className={`flex-1 text-xs rounded px-2 py-1 break-all ${
                    isDark
                      ? "text-yellow-100 bg-gray-900"
                      : "text-yellow-900 bg-yellow-100"
                  }`}
                >
                  {newAgentToken}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(newAgentToken);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                >
                  {copiedToken ? t("settings.copied") : t("settings.copy")}
                </Button>
              </div>
            </div>
          )}

          {agents.length > 0 && (
            <div className="space-y-2">
              {agents.map((agent) => (
                <Card
                  key={agent.id}
                  tone="muted"
                  className="p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>{agent.name}</span>
                        <code
                          className={`text-xs px-1.5 rounded ${
                            isDark
                              ? "text-indigo-300 bg-indigo-900/30"
                              : "text-indigo-700 bg-indigo-100"
                          }`}
                        >
                          @{agent.mentionKey}
                        </code>
                        <Badge variant={agent.isActive ? "success" : "warning"}>
                          {agent.isActive ? t("settings.active") : t("settings.pending")}
                        </Badge>
                      </div>
                      <div className={`text-xs mt-0.5 truncate ${isDark ? "text-gray-500" : "text-gray-600"}`}>
                        {agent.webhookUrl}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                          {t("settings.visibility")}:
                        </span>
                        <Select
                          value={agent.visibility || "private"}
                          onChange={async (e) => {
                            const token = localStorage.getItem("triologue_token");
                            try {
                              const res = await fetch(`/api/agents/${agent.id}/visibility`, {
                                method: "PATCH",
                                headers: {
                                  Authorization: `Bearer ${token}`,
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ visibility: e.target.value }),
                              });
                              if (res.ok) {
                                const listRes = await fetch("/api/agents/mine", {
                                  headers: { Authorization: `Bearer ${token}` },
                                });
                                if (listRes.ok) setAgents(await listRes.json());
                              }
                            } catch {
                              /* ignore */
                            }
                          }}
                          className="w-auto min-w-[180px] py-1 text-xs"
                        >
                          <option value="private">{t("settings.visibility.private")}</option>
                          <option value="public">{t("settings.visibility.public")}</option>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => deleteAgent(agent.id)}
                      >
                        {t("settings.delete")}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
        )}

        {activeTab === "danger" && (
        <Card className={`p-4 sm:p-6 space-y-4 ${isDark ? "border-red-800" : "border-red-300"}`}>
          <SectionHeader
            title={<span className="text-red-400">{t("settings.dangerZone")}</span>}
          />
          <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
            <span
              dangerouslySetInnerHTML={safeHtml(
                t("settings.deleteAccountText").replace("{username}", user?.username || ""),
              )}
            />
          </p>
          <Input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user?.username}
            className="focus:ring-red-500"
          />
          <Button
            onClick={deleteAccount}
            disabled={isDeleting || deleteConfirm !== user?.username}
            variant="danger"
          >
            {isDeleting ? t("settings.deleting") : t("settings.deleteAccount")}
          </Button>
        </Card>
        )}

        <ConfirmDialog
          open={!!agentToDelete}
          title={t("settings.deleteAgentTitle")}
          message={t("settings.deleteAgentConfirm")}
          confirmLabel={t("chat.delete")}
          cancelLabel={t("chat.cancel")}
          variant="danger"
          loading={isDeletingAgent}
          onConfirm={confirmDeleteAgent}
          onCancel={() => setAgentToDelete(null)}
        />
      </div>
    </PageShell>
  );
};
