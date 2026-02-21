import React, { useState, useEffect, useCallback } from "react";
import { UsersIcon, UserPlusIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuthStore } from "../../stores/authStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { InvitePopup } from "./InvitePopup";

interface Room {
  id: string;
  name: string;
  description?: string;
}

interface ChatHeaderProps {
  room: Room | null;
  onToggleUserList: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ room, onToggleUserList }) => {
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const isDark = theme === "dark";
  const { t } = useLanguage();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteStatus, setInviteStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [myRole, setMyRole] = useState("MEMBER");

  // Check role
  const loadRole = useCallback(async () => {
    if (!room) return;
    try {
      const token = localStorage.getItem("triologue_token");
      const res = await fetch(`/api/rooms/${room.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const me = data.participants?.find((p: any) => p.username === user?.username);
        setMyRole(me?.role ?? "MEMBER");
      }
    } catch { /* silent */ }
  }, [room?.id, user?.username]);

  useEffect(() => { loadRole(); }, [loadRole]);

  const canInvite = ["OWNER", "ADMIN", "MODERATOR"].includes(myRole) || (user as any)?.isAdmin;
  const canExport = canInvite; // same roles

  const handleExport = async (format: 'md' | 'json') => {
    if (!room) return;
    const token = localStorage.getItem("triologue_token");
    try {
      const res = await fetch(`/api/rooms/${room.id}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${room.name}-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim() || !room) return;
    setIsInviting(true);
    setInviteStatus(null);
    try {
      const token = localStorage.getItem("triologue_token");
      const res = await fetch(`/api/rooms/${room.id}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteStatus({ type: "ok", msg: `${data.invitedUser} added!` });
        setInviteUsername("");
        setTimeout(() => { setInviteStatus(null); setShowInvite(false); }, 2000);
      } else {
        setInviteStatus({ type: "err", msg: data.error ?? "Error" });
      }
    } catch {
      setInviteStatus({ type: "err", msg: "Network error" });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {room?.name || "Chat"}
          </h1>
          {room?.description && (
            <p className={`text-xs truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {room.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canExport && (
            <div className="relative group">
              <button
                className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
                title={t("chat.export.button")}
                onClick={() => handleExport('md')}
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
              </button>
              {/* Long-press / right-click hint via tooltip — simple: click = MD */}
            </div>
          )}
          {canInvite && (
            <button
              onClick={() => { setShowInvite(o => !o); setInviteStatus(null); setInviteUsername(""); }}
              className={`p-1.5 rounded-lg transition-colors ${
                showInvite
                  ? isDark ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700"
                  : isDark ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-100 text-gray-600"
              }`}
              title={t("chat.invite.button")}
            >
              <UserPlusIcon className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onToggleUserList}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
          >
            <UsersIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Inline invite form */}
      {showInvite && (
        <form onSubmit={handleInvite} className="mt-2 flex gap-2 items-center relative">
          <div className="flex-1 relative">
            <input
              autoFocus
              type="text"
              value={inviteUsername}
              onChange={e => { setInviteUsername(e.target.value); setInviteStatus(null); }}
              placeholder={t("chat.invite.placeholder")}
              className={`w-full px-2 py-1 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDark ? "bg-gray-700 border border-gray-600 text-white placeholder-gray-400" : "bg-white border border-gray-300 text-gray-900 placeholder-gray-500"
              }`}
            />
            {room && (
              <InvitePopup
                roomId={room.id}
                query={inviteUsername}
                visible={showInvite && inviteUsername.length > 0}
                onSelect={(username) => {
                  setInviteUsername(username);
                }}
              />
            )}
          </div>
          <button
            type="submit"
            disabled={isInviting || !inviteUsername.trim()}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-medium text-white transition-colors"
          >
            {isInviting ? "…" : t("chat.invite.button")}
          </button>
          {inviteStatus && (
            <span className={`text-xs ${inviteStatus.type === "ok" ? "text-green-400" : "text-red-400"}`}>
              {inviteStatus.msg}
            </span>
          )}
        </form>
      )}
    </div>
  );
};
