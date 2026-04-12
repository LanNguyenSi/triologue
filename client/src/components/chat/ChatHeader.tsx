import React, { useState, useEffect, useCallback } from "react";
import { UsersIcon, UserPlusIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, MapPinIcon } from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuthStore } from "../../stores/authStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { InvitePopup } from "./InvitePopup";
import { useNotificationStore } from "../../stores/notificationStore";
import { NotificationCenter } from "../ui/NotificationCenter";
import { useChatStore } from "../../stores/chatStore";

interface Room {
  id: string;
  name: string;
  description?: string;
}

interface ChatHeaderProps {
  room: Room | null;
  onToggleUserList: () => void;
  onJumpToMessage: (messageId: string) => Promise<void> | void;
}

interface SearchMessageItem {
  id: string;
  content: string;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
  };
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ room, onToggleUserList, onJumpToMessage }) => {
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const isDark = theme === "dark";
  const { t } = useLanguage();
  const addNotification = useNotificationStore((state) => state.add);

  const [showInvite, setShowInvite] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteStatus, setInviteStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMessageItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchLoadError, setSearchLoadError] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<SearchMessageItem[]>([]);
  const [pinnedCount, setPinnedCount] = useState(0);
  const messages = useChatStore((s) => s.messages);

  // Fetch pinned messages when room changes or messages change (to catch pin/unpin updates)
  const loadPinnedMessages = useCallback(async () => {
    if (!room) return;
    try {
      const token = localStorage.getItem("triologue_token");
      const res = await fetch(`/api/messages/${room.id}/pinned`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPinnedMessages(Array.isArray(data.messages) ? data.messages : []);
        setPinnedCount(data.count ?? 0);
      }
    } catch { /* silent */ }
  }, [room?.id]);

  useEffect(() => { loadPinnedMessages(); }, [loadPinnedMessages]);

  // Re-fetch when messages array changes (catches pin/unpin socket updates)
  useEffect(() => {
    const pinChanged = messages.some((m) => m.isPinned);
    loadPinnedMessages();
  }, [messages.filter((m) => m.isPinned).length, loadPinnedMessages]);
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

  // Reset invite form on room change
  useEffect(() => {
    setShowInvite(false);
    setShowSearch(false);
    setInviteUsername("");
    setInviteStatus(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchLoadError(false);
  }, [room?.id]);

  useEffect(() => {
    if (!showSearch || !room) return;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setSearchLoadError(false);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchLoadError(false);
      try {
        const token = localStorage.getItem("triologue_token");
        const response = await fetch(
          `/api/messages/${room.id}/search?q=${encodeURIComponent(normalizedQuery)}&limit=20`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`Search failed (${response.status})`);
        }
        const payload = await response.json();
        setSearchResults(Array.isArray(payload.items) ? payload.items : []);
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        setSearchResults([]);
        setSearchLoadError(true);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [room?.id, searchQuery, showSearch]);

  const canInvite = ["OWNER", "ADMIN", "MODERATOR"].includes(myRole) || (user as any)?.isAdmin;
  const canExport = canInvite; // same roles
  const normalizedSearchQuery = searchQuery.trim();

  const handleSearchResultClick = async (messageId: string) => {
    await onJumpToMessage(messageId);
    setShowSearch(false);
  };

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
        const success = t("chat.addedSuccess").replace(
          "{username}",
          data.invitedUser ?? inviteUsername.trim(),
        );
        setInviteStatus({ type: "ok", msg: success });
        if (data.syncedProjectId && data.teamSynced) {
          const syncText = t("chat.notice.participantSyncedToProject")
            .replace("{username}", data.invitedUser ?? inviteUsername.trim())
            .replace("{projectId}", data.syncedProjectId);
          toast.success(
            syncText,
          );
          addNotification({
            type: "info",
            title: t("notifications.teamSyncedTitle"),
            message: syncText,
            link: `/projects/${data.syncedProjectId}`,
          });
        }
        setInviteUsername("");
        setTimeout(() => { setInviteStatus(null); setShowInvite(false); }, 2000);
      } else {
        const msg = data.error?.includes('owner') || data.error?.includes('admin')
          ? t("chat.invite.noPermission")
          : data.error?.includes('not found') || data.error?.includes('Not found')
            ? t("chat.invite.notFound")
            : data.error?.includes('already')
              ? t("chat.invite.alreadyMember")
              : (data.error ?? t("chat.invite.error"));
        setInviteStatus({ type: "err", msg });
      }
    } catch {
      setInviteStatus({ type: "err", msg: t("chat.invite.networkError") });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {room?.name || t("dash.chat.title")}
          </h1>
          {room?.description && (
            <p className={`text-xs truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {room.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <NotificationCenter mode="inline" className="hidden md:block" />
          {canExport && (
            <div className="relative group">
              <button
                className={`p-1.5 rounded-lg transition-colors duration-200 ${isDark ? "hover:bg-gray-800/60 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
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
              onClick={() => {
                setShowInvite((open) => !open);
                setShowSearch(false);
                setInviteStatus(null);
                setInviteUsername("");
              }}
              className={`p-1.5 rounded-lg transition-colors duration-200 ${
                showInvite
                  ? isDark ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700"
                  : isDark ? "hover:bg-gray-800/60 text-gray-300" : "hover:bg-gray-100 text-gray-600"
              }`}
              title={t("chat.invite.button")}
            >
              <UserPlusIcon className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              setShowSearch((open) => !open);
              setShowInvite(false);
              setInviteStatus(null);
            }}
            className={`p-1.5 rounded-lg transition-colors duration-200 ${
              showSearch
                ? isDark ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700"
                : isDark ? "hover:bg-gray-800/60 text-gray-300" : "hover:bg-gray-100 text-gray-600"
            }`}
            title={t("chat.search.button")}
            aria-label={t("chat.search.button")}
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleUserList}
            className={`p-1.5 rounded-lg transition-colors duration-200 ${isDark ? "hover:bg-gray-800/60 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
            title={t("chat.participants")}
            aria-label={t("chat.participants")}
          >
            <UsersIcon className="w-4 h-4" />
          </button>
        </div>
      </div>


      {/* Pinned messages banner */}
      {pinnedCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setShowPinned((open) => !open);
            setShowInvite(false);
            setShowSearch(false);
          }}
          className={`mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors duration-200 ${
            showPinned
              ? isDark ? "bg-amber-900/20 text-amber-300 border border-amber-700/30" : "bg-amber-50 text-amber-700 border border-amber-200"
              : isDark ? "bg-gray-800/60 text-gray-300 hover:bg-gray-800" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
          }`}
        >
          <MapPinIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-medium">{pinnedCount} {t(pinnedCount === 1 ? "chat.pinnedMessage" : "chat.pinnedMessages")}</span>
          <span className="ml-auto text-[10px] text-gray-400">{showPinned ? "▲" : "▼"}</span>
        </button>
      )}

      {/* Pinned messages panel */}
      {showPinned && pinnedMessages.length > 0 && (
        <div className={`mt-1 max-h-48 overflow-y-auto rounded-lg border ${isDark ? "border-gray-700/50 bg-gray-800/80" : "border-gray-200/60 bg-white shadow-subtle"}`}>
          {pinnedMessages.map((item: any) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                void onJumpToMessage(item.id);
                setShowPinned(false);
              }}
              className={`w-full text-left px-2.5 py-2 border-b last:border-b-0 transition-colors duration-200 ${
                isDark ? "border-gray-700/50 hover:bg-gray-700/70 text-gray-100" : "border-gray-100 hover:bg-gray-50 text-gray-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <MapPinIcon className={`w-3 h-3 flex-shrink-0 ${isDark ? "text-amber-400/60" : "text-amber-500/60"}`} />
                <span className="truncate text-xs font-semibold">
                  {item.sender?.displayName || item.sender?.username || ""}
                </span>
                <span className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              <div className={`mt-0.5 text-xs line-clamp-2 ml-5 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                {item.content}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Inline invite form */}
      {showInvite && (
        <form onSubmit={handleInvite} className="mt-2 flex gap-2 items-center relative">
          <div className="flex-1 relative">
            <label className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {t("chat.invite.placeholder")} <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={inviteUsername}
              onChange={e => { setInviteUsername(e.target.value); setInviteStatus(null); }}
              placeholder={t("chat.invite.placeholder")}
              className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:ring-offset-1 transition-colors duration-200 ${
                isDark ? "bg-gray-700/80 border border-gray-600/50 text-white placeholder-gray-400" : "bg-white border border-gray-300/60 text-gray-900 placeholder-gray-500 shadow-subtle"
              }`}
              required
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
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-xs font-medium text-white transition-colors duration-200 shadow-subtle"
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

      {showSearch && (
        <div className="mt-2 space-y-2">
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("chat.search.placeholder")}
            className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:ring-offset-1 transition-colors duration-200 ${
              isDark
                ? "bg-gray-700/80 border border-gray-600/50 text-white placeholder-gray-400"
                : "bg-white border border-gray-300/60 text-gray-900 placeholder-gray-500 shadow-subtle"
            }`}
          />
          <div
            className={`max-h-56 overflow-y-auto rounded-lg border ${
              isDark ? "border-gray-700/50 bg-gray-800/80" : "border-gray-200/60 bg-white shadow-subtle"
            }`}
          >
            {normalizedSearchQuery.length < 2 ? (
              <div className={`px-2.5 py-2 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                {t("chat.search.minChars")}
              </div>
            ) : isSearching ? (
              <div className={`px-2.5 py-2 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                {t("chat.search.loading")}
              </div>
            ) : searchLoadError ? (
              <div className="px-2.5 py-2 text-xs text-red-400">
                {t("chat.search.error")}
              </div>
            ) : searchResults.length === 0 ? (
              <div className={`px-2.5 py-2 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                {t("chat.search.noResults")}
              </div>
            ) : (
              searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void handleSearchResultClick(item.id);
                  }}
                  className={`w-full text-left px-2.5 py-2 border-b last:border-b-0 transition-colors duration-200 ${
                    isDark
                      ? "border-gray-700/50 hover:bg-gray-700/70 text-gray-100"
                      : "border-gray-100 hover:bg-gray-50 text-gray-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-semibold">
                      {item.sender.displayName || item.sender.username}
                    </span>
                    <span className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={`mt-0.5 text-xs line-clamp-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                    {item.content}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
