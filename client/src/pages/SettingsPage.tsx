import { safeHtml } from "../utils/sanitize";
import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

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
  const [agentRoomId, setAgentRoomId] = useState("");
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [addingToRoom, setAddingToRoom] = useState<string | null>(null); // agentId or null
  const [selectedRoomForAdd, setSelectedRoomForAdd] = useState("");

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

  const addAgentToRoom = async (agentId: string) => {
    if (!selectedRoomForAdd) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/rooms`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ roomId: selectedRoomForAdd }),
      });
      if (res.ok) {
        setAddingToRoom(null);
        setSelectedRoomForAdd("");
        // Optionally show success message
      }
    } catch {
      /* ignore */
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

  return (
    <div
      className={`min-h-screen p-4 ${theme === "dark" ? "bg-gray-900" : "bg-gray-100"}`}
    >
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 pt-4">
          <Link
            to="/room/onboarding"
            className={`text-sm transition-colors ${
              theme === "dark"
                ? "text-gray-400 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t("settings.back")}
          </Link>
          <h1
            className={`text-xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}
          >
            {t("settings.title")}
          </h1>
        </div>

        {/* Preferences section */}
        <div
          className={`rounded-xl p-6 space-y-4 ${
            theme === "dark" ? "bg-gray-800" : "bg-white shadow-md"
          }`}
        >
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              theme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {t("settings.preferences")}
          </h2>

          {/* Language Toggle */}
          <div>
            <label
              className={`block text-sm font-medium mb-1 ${
                theme === "dark" ? "text-gray-300" : "text-gray-700"
              }`}
            >
              {t("settings.language")}
            </label>
            <p
              className={`text-xs mb-2 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.languageDesc")}
            </p>
            <div
              className={`flex gap-2 p-1 rounded-lg ${
                theme === "dark" ? "bg-gray-700" : "bg-gray-100"
              }`}
            >
              <button
                onClick={() => setLanguage("de")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  language === "de"
                    ? "bg-indigo-600 text-white"
                    : theme === "dark"
                      ? "text-gray-300 hover:text-white"
                      : "text-gray-700 hover:text-gray-900"
                }`}
              >
                🇩🇪 Deutsch
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  language === "en"
                    ? "bg-indigo-600 text-white"
                    : theme === "dark"
                      ? "text-gray-300 hover:text-white"
                      : "text-gray-700 hover:text-gray-900"
                }`}
              >
                🇬🇧 English
              </button>
            </div>
          </div>

          {/* Theme Toggle */}
          <div>
            <label
              className={`block text-sm font-medium mb-1 ${
                theme === "dark" ? "text-gray-300" : "text-gray-700"
              }`}
            >
              {t("settings.theme")}
            </label>
            <p
              className={`text-xs mb-2 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.themeDesc")}
            </p>
            <div
              className={`flex gap-2 p-1 rounded-lg ${
                theme === "dark" ? "bg-gray-700" : "bg-gray-100"
              }`}
            >
              <button
                onClick={() => setTheme("dark")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  theme === "dark"
                    ? "bg-indigo-600 text-white"
                    : "text-gray-700 hover:text-gray-900"
                }`}
              >
                🌙 {t("settings.themeDark")}
              </button>
              <button
                onClick={() => setTheme("light")}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  theme === "light"
                    ? "bg-indigo-600 text-white"
                    : theme === "dark"
                      ? "text-gray-300 hover:text-white"
                      : "text-gray-700 hover:text-gray-900"
                }`}
              >
                ☀️ {t("settings.themeLight")}
              </button>
            </div>
          </div>
        </div>

        {/* Profile section */}
        <div
          className={`rounded-xl p-6 space-y-4 ${
            theme === "dark" ? "bg-gray-800" : "bg-white shadow-md"
          }`}
        >
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              theme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {t("settings.profile")}
          </h2>
          <div>
            <label
              className={`block text-sm mb-1 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.username")}
            </label>
            <div
              className={`rounded-lg px-3 py-2 text-sm opacity-60 select-all ${
                theme === "dark"
                  ? "text-white bg-gray-700"
                  : "text-gray-900 bg-gray-100"
              }`}
            >
              @{user?.username}
            </div>
          </div>
          <div>
            <label
              className={`block text-sm mb-1 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("settings.displayName")}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === "dark"
                  ? "bg-gray-700 text-white"
                  : "bg-white border border-gray-300 text-gray-900"
              }`}
              maxLength={50}
            />
          </div>
          {profileMsg && (
            <p
              className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}
            >
              {profileMsg}
            </p>
          )}
          <button
            onClick={saveProfile}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {t("settings.saveProfile")}
          </button>
        </div>

        {/* Password section */}
        <div
          className={`rounded-xl p-6 space-y-4 ${
            theme === "dark" ? "bg-gray-800" : "bg-white shadow-md"
          }`}
        >
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              theme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {t("settings.changePassword")}
          </h2>
          {passwordLabels.map((label, i) => {
            const vals = [currentPassword, newPassword, confirmPassword];
            const setters = [
              setCurrentPassword,
              setNewPassword,
              setConfirmPassword,
            ];
            return (
              <div key={label}>
                <label
                  className={`block text-sm mb-1 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
                >
                  {label}
                </label>
                <input
                  type="password"
                  value={vals[i]}
                  onChange={(e) => setters[i](e.target.value)}
                  className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                    theme === "dark"
                      ? "bg-gray-700 text-white"
                      : "bg-white border border-gray-300 text-gray-900"
                  }`}
                />
              </div>
            );
          })}
          {passwordMsg && (
            <p
              className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}
            >
              {passwordMsg}
            </p>
          )}
          <button
            onClick={changePassword}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {t("settings.changePassword")}
          </button>
        </div>

        {/* My Agents (BYOA) */}
        <div
          className={`rounded-xl p-6 space-y-4 ${
            theme === "dark" ? "bg-gray-800" : "bg-white shadow-md"
          }`}
        >
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              theme === "dark" ? "text-gray-300" : "text-gray-700"
            }`}
          >
            {t("settings.myAgents")}
          </h2>
          <Link
            to="/byoa"
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              theme === "dark"
                ? "bg-indigo-950/30 border-indigo-800/50 hover:border-indigo-600"
                : "bg-indigo-50 border-indigo-200 hover:border-indigo-400"
            }`}
          >
            <span className="text-2xl">🤖</span>
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-medium ${
                  theme === "dark" ? "text-indigo-300" : "text-indigo-700"
                }`}
              >
                {t("settings.byoaBanner.title")}
              </div>
              <div
                className={`text-xs ${
                  theme === "dark" ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {t("settings.byoaBanner.desc")}
              </div>
            </div>
            <span
              className={`text-sm ${
                theme === "dark" ? "text-indigo-400" : "text-indigo-600"
              }`}
            >
              →
            </span>
          </Link>

          {/* Register form */}
          <div className="space-y-2">
            <input
              type="text"
              placeholder={t("settings.agentName")}
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === "dark"
                  ? "bg-gray-700 text-white"
                  : "bg-white border border-gray-300 text-gray-900"
              }`}
            />
            <input
              type="url"
              placeholder={t("settings.webhookUrl")}
              value={agentWebhook}
              onChange={(e) => setAgentWebhook(e.target.value)}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === "dark"
                  ? "bg-gray-700 text-white"
                  : "bg-white border border-gray-300 text-gray-900"
              }`}
            />
            <input
              type="text"
              placeholder={t("settings.descriptionOptional")}
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === "dark"
                  ? "bg-gray-700 text-white"
                  : "bg-white border border-gray-300 text-gray-900"
              }`}
            />
            <select
              value={agentRoomId}
              onChange={(e) => setAgentRoomId(e.target.value)}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === "dark"
                  ? "bg-gray-700 text-white"
                  : "bg-white border border-gray-300 text-gray-900"
              }`}
            >
              <option value="">{t("settings.addToRoom")}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              onClick={createAgent}
              disabled={
                creatingAgent || !agentName.trim() || !agentWebhook.trim()
              }
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {creatingAgent
                ? t("settings.creating")
                : t("settings.registerAgent")}
            </button>
          </div>

          {/* One-time token */}
          {newAgentToken && (
            <div className="p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg space-y-2">
              <p className="text-xs text-yellow-300 font-semibold">
                {t("settings.tokenWarning")}
              </p>
              <p className="text-xs text-gray-400">
                <span
                  dangerouslySetInnerHTML={safeHtml(t("settings.pendingNotice"))}
                />
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-yellow-100 bg-gray-900 rounded px-2 py-1 break-all">
                  {newAgentToken}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newAgentToken);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                  className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs rounded flex-shrink-0"
                >
                  {copiedToken ? t("settings.copied") : t("settings.copy")}
                </button>
              </div>
            </div>
          )}

          {/* Agent list */}
          {agents.length > 0 && (
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`p-3 rounded-lg space-y-2 ${
                    theme === "dark" ? "bg-gray-700/50" : "bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-medium text-sm ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                        >
                          {agent.name}
                        </span>
                        <code className="text-xs text-indigo-300 bg-indigo-900/30 px-1.5 rounded">
                          @{agent.mentionKey}
                        </code>
                        <span
                          className={`text-xs px-1.5 rounded ${agent.isActive ? "bg-green-900/40 text-green-300" : "bg-yellow-900/40 text-yellow-300"}`}
                        >
                          {agent.isActive
                            ? t("settings.active")
                            : t("settings.pending")}
                        </span>
                      </div>
                      <div
                        className={`text-xs mt-0.5 truncate ${theme === "dark" ? "text-gray-500" : "text-gray-600"}`}
                      >
                        {agent.webhookUrl}
                      </div>
                      {/* Visibility selector */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] uppercase tracking-wider ${theme === "dark" ? "text-gray-500" : "text-gray-400"}`}>
                          {t("settings.visibility")}:
                        </span>
                        <select
                          value={agent.visibility || 'private'}
                          onChange={async (e) => {
                            const token = localStorage.getItem("triologue_token");
                            try {
                              const res = await fetch(`/api/agents/${agent.id}/visibility`, {
                                method: "PATCH",
                                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                                body: JSON.stringify({ visibility: e.target.value }),
                              });
                              if (res.ok) {
                                // Reload agents list
                                const listRes = await fetch("/api/agents/mine", { headers: { Authorization: `Bearer ${token}` } });
                                if (listRes.ok) setAgents(await listRes.json());
                              }
                            } catch {}
                          }}
                          className={`text-xs rounded px-2 py-0.5 outline-none ${
                            theme === "dark"
                              ? "bg-gray-600 text-gray-200 border-gray-500"
                              : "bg-white text-gray-700 border border-gray-300"
                          }`}
                        >
                          <option value="private">{t("settings.visibility.private")}</option>
                          <option value="public">{t("settings.visibility.public")}</option>
                          {/* <option value="shared">{t("settings.visibility.shared")}</option> — needs user picker UI */}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => deleteAgent(agent.id)}
                        className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-700 text-red-300 rounded transition-colors"
                      >
                        {t("settings.delete")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={() => {
            logout();
            navigate("/");
          }}
          className={`w-full py-3 px-4 rounded-xl text-sm font-medium transition-colors ${
            theme === "dark"
              ? "bg-gray-800 hover:bg-gray-700 text-gray-300"
              : "bg-white hover:bg-gray-50 text-gray-700 shadow-md"
          }`}
        >
          {t("settings.logout")}
        </button>

        {/* Danger zone */}
        <div
          className={`border rounded-xl p-6 space-y-4 ${
            theme === "dark"
              ? "bg-gray-800 border-red-800"
              : "bg-white border-red-300 shadow-md"
          }`}
        >
          <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide">
            {t("settings.dangerZone")}
          </h2>
          <p
            className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
          >
            <span
              dangerouslySetInnerHTML={safeHtml(t("settings.deleteAccountText").replace(
                  "{username}",
                  user?.username || "",
                ))}
            />
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user?.username}
            className={`w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500 ${
              theme === "dark"
                ? "bg-gray-700 text-white"
                : "bg-white border border-gray-300 text-gray-900"
            }`}
          />
          <button
            onClick={deleteAccount}
            disabled={isDeleting || deleteConfirm !== user?.username}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
          >
            {isDeleting ? t("settings.deleting") : t("settings.deleteAccount")}
          </button>
        </div>

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
    </div>
  );
};
