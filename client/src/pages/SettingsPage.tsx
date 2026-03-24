import { safeHtml } from "../utils/sanitize";
import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { useAuthStore } from "../stores/authStore";
import { usePluginStore } from "../stores/pluginStore";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import { SensitiveTokenCard } from "../components/ui/SensitiveTokenCard";
import {
  Badge,
  Button,
  Card,
  Input,
  SectionHeader,
  Select,
} from "../components/ui/primitives";
import { PluginManifest } from "../types/plugins";
import { activeStateBadgeVariant } from "../utils/statusBadges";
import {
  getActionCenterStartExpanded,
  setActionCenterStartExpanded as setActionCenterStartExpandedPreference,
} from "../utils/actionCenterPreference";

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

type SettingsTab = "preferences" | "profile" | "agents" | "plugins" | "danger";

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
  const [agentTrustLevel, setAgentTrustLevel] = useState<"standard" | "elevated">("standard");
  const [agentReceiveMode, setAgentReceiveMode] = useState<"mentions" | "all">("mentions");
  const [agentDelivery, setAgentDelivery] = useState<"sse" | "webhook" | "openclaw-inject">("sse");
  const [agentRoomId, setAgentRoomId] = useState("");
  const [agentFormError, setAgentFormError] = useState("");
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [newAgentStatus, setNewAgentStatus] = useState<"pending" | "active" | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences");
  const [actionCenterStartExpanded, setActionCenterStartExpanded] = useState(
    () => getActionCenterStartExpanded(),
  );
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [pluginStatusMessage, setPluginStatusMessage] = useState("");
  const [pluginToggleId, setPluginToggleId] = useState<string | null>(null);
  const refreshSidebarPlugins = usePluginStore((state) => state.loadPlugins);

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

  const fetchPluginSettings = useCallback(async () => {
    setLoadingPlugins(true);
    setPluginStatusMessage("");
    try {
      const res = await fetch("/api/plugins/preferences", { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t("settings.pluginsLoadFailed"));
      }
      const entries = Array.isArray(data?.plugins) ? data.plugins : [];
      setPlugins(entries);
    } catch (error: any) {
      setPluginStatusMessage(error?.message || t("settings.pluginsLoadFailed"));
      setPlugins([]);
    } finally {
      setLoadingPlugins(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeTab !== "plugins") return;
    void fetchPluginSettings();
  }, [activeTab, fetchPluginSettings]);

  const updatePluginEnabled = async (pluginId: string, enabled: boolean) => {
    setPluginToggleId(pluginId);
    setPluginStatusMessage("");
    try {
      const res = await fetch(`/api/plugins/preferences/${pluginId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t("settings.pluginsUpdateFailed"));
      }

      const updatedPlugin = data?.plugin;
      if (updatedPlugin?.id) {
        setPlugins((prev) =>
          prev.map((plugin) => (plugin.id === updatedPlugin.id ? updatedPlugin : plugin)),
        );
      } else {
        await fetchPluginSettings();
      }

      await refreshSidebarPlugins();
      setPluginStatusMessage(t("settings.pluginsUpdated"));
    } catch (error: any) {
      setPluginStatusMessage(error?.message || t("settings.pluginsUpdateFailed"));
    } finally {
      setPluginToggleId(null);
    }
  };

  const createAgent = async () => {
    if (!agentName.trim()) {
      setAgentFormError(t("settings.error.agentNameRequired"));
      return;
    }
    setAgentFormError("");
    setCreatingAgent(true);
    setNewAgentToken(null);
    setNewAgentStatus(null);
    try {
      const body: Record<string, string> = {
        name: agentName.trim(),
        ...(agentWebhook.trim() ? { webhookUrl: agentWebhook.trim() } : {}),
        description: agentDesc.trim(),
        emoji: agentEmoji,
        color: agentColor,
        trustLevel: agentTrustLevel,
        receiveMode: agentReceiveMode,
        delivery: agentDelivery,
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
        setNewAgentStatus(data.status === "active" ? "active" : "pending");
        setAgentName("");
        setAgentWebhook("");
        setAgentDesc("");
        setAgentEmoji("🤖");
        setAgentColor("#888888");
        setAgentTrustLevel("standard");
        setAgentReceiveMode("mentions");
        setAgentDelivery("sse");
        setAgentRoomId("");
        setAgentFormError("");
        fetchAgents();
      } else {
        if (data?.code === "AGENT_MENTION_KEY_TAKEN") {
          const mentionKey = String(data?.mentionKey || "");
          setAgentFormError(
            t("settings.error.mentionKeyTaken").replace("{mentionKey}", mentionKey),
          );
          return;
        }
        setAgentFormError(
          data.error ||
            t("settings.error.createAgentWithStatus").replace("{status}", String(res.status)),
        );
      }
    } catch (err: any) {
      setAgentFormError(err.message || t("settings.error.createAgent"));
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
      const res = await fetch(`/api/agents/${agentToDelete}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAgentFormError(
          data?.error ||
            t("settings.error.deleteAgentWithStatus").replace("{status}", String(res.status)),
        );
        return;
      }
      setAgentFormError("");
      fetchAgents();
      setNewAgentToken(null);
      setNewAgentStatus(null);
    } catch {
      setAgentFormError(t("settings.networkError"));
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

  const handleProfileSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveProfile();
  };

  const handlePasswordSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void changePassword();
  };

  const handleCreateAgentSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createAgent();
  };

  const handleDeleteAccountSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void deleteAccount();
  };

  const passwordLabels = [
    t("settings.currentPassword"),
    t("settings.newPassword"),
    t("settings.confirmNewPassword"),
  ];
  const passwordFieldIds = [
    "settings-current-password",
    "settings-new-password",
    "settings-confirm-password",
  ];
  const isDark = theme === "dark";
  const settingTabs: Array<{ key: SettingsTab; label: string }> = [
    { key: "preferences", label: t("settings.preferences") },
    { key: "profile", label: t("settings.profile") },
    { key: "agents", label: t("settings.myAgents") },
    { key: "plugins", label: t("settings.plugins") },
  ];
  const dangerTab = { key: "danger" as const, label: t("settings.dangerZone") };
  const allTabs = [...settingTabs, dangerTab];

  return (
    <PageShell
      maxWidth="6xl"
      title={t("settings.title")}
      subtitle={t("settings.subtitle")}
    >
      <div className="space-y-4 sm:space-y-5">
        <Card tone="muted" className="p-1.5 sm:p-2">
          <div
            role="tablist"
            aria-label={t("settings.title")}
            className={`flex flex-wrap gap-1 border-b px-1 ${isDark ? "border-gray-700/50" : "border-gray-200/60"}`}
          >
            {allTabs.map((entry) => {
              const active = activeTab === entry.key;
              const isDanger = entry.key === dangerTab.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-all duration-200 ${
                    active
                      ? isDanger
                        ? isDark
                          ? "border-red-400 text-red-300 bg-red-950/30"
                          : "border-red-500 text-red-700 bg-red-50"
                        : isDark
                          ? "border-blue-400 text-blue-300 bg-gray-800"
                          : "border-blue-600 text-blue-700 bg-white"
                      : isDanger
                        ? isDark
                          ? "border-transparent text-red-300 hover:text-red-200 hover:bg-gray-800/70"
                          : "border-transparent text-red-700 hover:text-red-800 hover:bg-gray-100"
                        : isDark
                          ? "border-transparent text-gray-300 hover:text-white hover:bg-gray-800/70"
                          : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                  onClick={() => setActiveTab(entry.key)}
                >
                  {entry.label}
                </button>
              );
            })}
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
                <MoonIcon className="w-4 h-4 inline -mt-0.5" /> {t("settings.themeDark")}
              </Button>
              <Button
                type="button"
                onClick={() => setTheme("light")}
                variant={theme === "light" ? "primary" : "secondary"}
                className="flex-1"
              >
                <SunIcon className="w-4 h-4 inline -mt-0.5" /> {t("settings.themeLight")}
              </Button>
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("settings.actionCenterStart")}
            </label>
            <p className={`text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.actionCenterStartDesc")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => {
                  setActionCenterStartExpanded(false);
                  setActionCenterStartExpandedPreference(false);
                }}
                variant={!actionCenterStartExpanded ? "primary" : "secondary"}
                className="flex-1"
              >
                {t("settings.actionCenterCollapsed")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setActionCenterStartExpanded(true);
                  setActionCenterStartExpandedPreference(true);
                }}
                variant={actionCenterStartExpanded ? "primary" : "secondary"}
                className="flex-1"
              >
                {t("settings.actionCenterExpanded")}
              </Button>
            </div>
          </div>
        </Card>
        )}

        {activeTab === "profile" && (
        <Card className="p-4 sm:p-6 space-y-4">
          <SectionHeader title={t("settings.profile")} />
          <form onSubmit={handleProfileSubmit} className="space-y-4">
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
              <label
                htmlFor="settings-display-name"
                className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("settings.displayName")} <span className="text-red-400">*</span>
              </label>
              <Input
                id="settings-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                required
              />
            </div>
            {profileMsg && <p className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{profileMsg}</p>}
            <Button type="submit" disabled={isSaving}>
              {t("settings.saveProfile")}
            </Button>
          </form>

          <SectionHeader title={t("settings.changePassword")} />
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {passwordLabels.map((label, i) => {
              const vals = [currentPassword, newPassword, confirmPassword];
              const setters = [setCurrentPassword, setNewPassword, setConfirmPassword];
              return (
                <div key={label}>
                  <label
                    htmlFor={passwordFieldIds[i]}
                    className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {label} <span className="text-red-400">*</span>
                  </label>
                  <Input
                    id={passwordFieldIds[i]}
                    type="password"
                    value={vals[i]}
                    onChange={(e) => setters[i](e.target.value)}
                    required
                  />
                </div>
              );
            })}
            {passwordMsg && <p className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>{passwordMsg}</p>}
            <Button type="submit" disabled={isSaving}>
              {t("settings.changePassword")}
            </Button>
          </form>

          <Button
            type="button"
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
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
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

          <form className="space-y-2" onSubmit={handleCreateAgentSubmit}>
            <label
              htmlFor="settings-agent-name"
              className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.agentName")} <span className="text-red-400">*</span>
            </label>
            <Input
              id="settings-agent-name"
              type="text"
              placeholder={t("settings.agentName")}
              value={agentName}
              onChange={(e) => {
                setAgentName(e.target.value);
                if (agentFormError) setAgentFormError("");
              }}
              required
            />
            {agentFormError && (
              <p className={`text-xs ${isDark ? "text-red-300" : "text-red-600"}`}>
                {agentFormError}
              </p>
            )}
            <label
              htmlFor="settings-agent-webhook"
              className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.webhookUrlOptional")}
            </label>
            <Input
              id="settings-agent-webhook"
              type="url"
              placeholder={t("settings.webhookUrlOptional")}
              value={agentWebhook}
              onChange={(e) => setAgentWebhook(e.target.value)}
            />
            <label
              htmlFor="settings-agent-description"
              className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.descriptionOptional")}
            </label>
            <Input
              id="settings-agent-description"
              type="text"
              placeholder={t("settings.descriptionOptional")}
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="settings-agent-emoji" className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("settings.agentEmoji") }</label>
                <Input
                  id="settings-agent-emoji"
                  placeholder="🤖"
                  value={agentEmoji}
                  onChange={(e) => setAgentEmoji(e.target.value)}
                />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>{ t("settings.agentColor") }</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={agentColor}
                    onChange={(e) => setAgentColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0"
                  />
                  <Input
                    id="settings-agent-color"
                    placeholder="#888888"
                    value={agentColor}
                    onChange={(e) => setAgentColor(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="settings-agent-trust-level"
                  className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                >
                  {t("settings.trustLevel")}
                </label>
                <Select
                  id="settings-agent-trust-level"
                  value={agentTrustLevel}
                  onChange={(value) => setAgentTrustLevel(value as "standard" | "elevated")}
                  options={[
                    { value: "standard", label: t("settings.trustStandard") },
                    { value: "elevated", label: t("settings.trustElevated") },
                  ]}
                />
              </div>
              <div>
                <label
                  htmlFor="settings-agent-receive"
                  className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                >
                  {t("settings.receive")}
                </label>
                <Select
                  id="settings-agent-receive"
                  value={agentReceiveMode}
                  onChange={(value) => setAgentReceiveMode(value as "mentions" | "all")}
                  options={[
                    { value: "mentions", label: t("settings.receiveMentions") },
                    { value: "all", label: t("settings.receiveAll") },
                  ]}
                />
              </div>
              <div>
                <label
                  htmlFor="settings-agent-delivery"
                  className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
                >
                  {t("settings.delivery")}
                </label>
                <Select
                  id="settings-agent-delivery"
                  value={agentDelivery}
                  onChange={(value) => setAgentDelivery(value as "sse" | "webhook" | "openclaw-inject")}
                  options={[
                    { value: "sse", label: "SSE + REST" },
                    { value: "webhook", label: t("settings.deliveryWebhook") },
                    { value: "openclaw-inject", label: t("settings.deliveryInject") },
                  ]}
                />
              </div>
            </div>
            <label
              htmlFor="settings-agent-room"
              className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.addToRoom")}
            </label>
            <Select 
              id="settings-agent-room" 
              value={agentRoomId} 
              onChange={(value) => setAgentRoomId(value)}
              placeholder={t("settings.addToRoom")}
              options={rooms.map((r) => ({
                value: r.id,
                label: r.name,
              }))}
            />
            <Button
              type="submit"
              disabled={creatingAgent || !agentName.trim()}
            >
              {creatingAgent ? t("settings.creating") : t("settings.registerAgent")}
            </Button>
          </form>

          {newAgentToken && (
            <SensitiveTokenCard
              warning={t("settings.tokenWarning")}
              description={(
                <span
                  dangerouslySetInnerHTML={safeHtml(
                    t(newAgentStatus === "active" ? "settings.activeNotice" : "settings.pendingNotice"),
                  )}
                />
              )}
              token={newAgentToken}
              copyLabel={t("settings.copy")}
              copiedLabel={t("settings.copied")}
              copied={copiedToken}
              onCopy={() => {
                navigator.clipboard.writeText(newAgentToken);
                setCopiedToken(true);
                setTimeout(() => setCopiedToken(false), 2000);
              }}
            />
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
                        <Badge variant={activeStateBadgeVariant(agent.isActive)}>
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
                          onChange={async (value) => {
                            const token = localStorage.getItem("triologue_token");
                            try {
                              const res = await fetch(`/api/agents/${agent.id}/visibility`, {
                                method: "PATCH",
                                headers: {
                                  Authorization: `Bearer ${token}`,
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ visibility: value }),
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
                          options={[
                            { value: "private", label: t("settings.visibility.private") },
                            { value: "public", label: t("settings.visibility.public") },
                          ]}
                        />
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
          <form onSubmit={handleDeleteAccountSubmit} className="space-y-4">
            <label
              htmlFor="settings-delete-confirm-username"
              className={`block text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.username")} <span className="text-red-400">*</span>
            </label>
            <Input
              id="settings-delete-confirm-username"
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={user?.username}
              className="focus:ring-red-500"
              required
            />
            <Button
              type="submit"
              disabled={isDeleting || deleteConfirm !== user?.username}
              variant="danger"
            >
              {isDeleting ? t("settings.deleting") : t("settings.deleteAccount")}
            </Button>
          </form>
        </Card>
        )}

        {activeTab === "plugins" && (
        <Card className="p-4 sm:p-6 space-y-4">
          <SectionHeader title={t("settings.plugins")} />
          <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
            {t("settings.pluginsDesc")}
          </p>

          {pluginStatusMessage && (
            <p className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {pluginStatusMessage}
            </p>
          )}

          {loadingPlugins ? (
            <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("common.loading")}
            </p>
          ) : plugins.length === 0 ? (
            <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
              {t("settings.pluginsEmpty")}
            </p>
          ) : (
            <div className="space-y-2">
              {plugins.map((plugin) => {
                const workspaceEnabled = plugin.workspaceEnabled !== false;
                const userEnabled = plugin.userEnabled !== false;
                const enabled = plugin.enabled !== false;
                return (
                  <Card key={plugin.id} tone="muted" className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {plugin.name}
                          </span>
                          <code className={`text-xs px-1.5 rounded ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700"}`}>
                            {plugin.id}
                          </code>
                          <Badge variant={activeStateBadgeVariant(enabled)}>
                            {enabled ? t("settings.active") : t("settings.inactive")}
                          </Badge>
                          {!workspaceEnabled && (
                            <Badge variant="warning">{t("settings.pluginsWorkspaceDisabled")}</Badge>
                          )}
                          {workspaceEnabled && !userEnabled && (
                            <Badge variant="warning">{t("settings.pluginsDisabledForMe")}</Badge>
                          )}
                        </div>
                        <div className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                          v{plugin.version}
                          {plugin.description ? ` - ${plugin.description}` : ""}
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant={userEnabled ? "secondary" : "primary"}
                        disabled={pluginToggleId === plugin.id || !workspaceEnabled}
                        onClick={() => updatePluginEnabled(plugin.id, !userEnabled)}
                      >
                        {!workspaceEnabled
                          ? t("settings.pluginsWorkspaceLocked")
                          : pluginToggleId === plugin.id
                            ? t("settings.saving")
                            : userEnabled
                              ? t("settings.disablePlugin")
                              : t("settings.enablePlugin")}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
        )}

        <ConfirmDialog
          open={!!agentToDelete}
          title={t("settings.deleteAgentTitle")}
          message={t("settings.deleteAgentConfirm")}
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
