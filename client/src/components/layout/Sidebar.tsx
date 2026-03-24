import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import {
  PlusIcon,
  LockClosedIcon,
  TrashIcon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  CpuChipIcon,
  GlobeAltIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../../stores/authStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSocketStore } from "../../stores/socketStore";
import { useChatStore } from "../../stores/chatStore";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { CreateRoomModal } from "../chat/CreateRoomModal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useNotificationStore } from "../../stores/notificationStore";

interface SidebarProps {
  onToggle?: () => void;
}

const ROOM_TYPE_ICONS: Record<string, React.ReactNode> = {
  TRIOLOGUE: <UserGroupIcon className="w-4 h-4" />,
  HUMAN_AI: <ChatBubbleLeftRightIcon className="w-4 h-4" />,
  AI_ONLY: <CpuChipIcon className="w-4 h-4" />,
  PUBLIC: <GlobeAltIcon className="w-4 h-4" />,
  PRIVATE: <LockClosedIcon className="w-4 h-4" />,
};

interface Participant {
  userId: string;
  username: string;
  displayName: string;
  userType: string;
  role: string;
  isOnline: boolean;
  presenceStatus?: 'online' | 'active' | 'offline';
}

const getParticipantIcon = (userType: string, userId?: string) => {
  if (userId) {
    const emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
    if (emoji) return emoji;
  }
  if (userType === "HUMAN") return <UserIcon className="w-3.5 h-3.5" />;
  return <CpuChipIcon className="w-3.5 h-3.5" />;
};

const getAvatarStyle = (userType: string, theme: string) => {
  const styles: Record<string, { dark: string; light: string }> = {
    HUMAN: {
      dark: "bg-blue-900/40 border border-blue-600/50",
      light: "bg-blue-100 border border-blue-300",
    },
  };
  // For agents, use a generic purple style (color comes from agentStore)
  const agentStyle = {
    dark: "bg-purple-900/40 border border-purple-600/50",
    light: "bg-purple-100 border border-purple-300",
  };
  const isAgent = ["AI_AGENT", "AI_ICE", "AI_LAVA", "AI_OTHER"].includes(userType);
  const s = isAgent ? agentStyle : (styles[userType] ?? agentStyle);
  return theme === "dark" ? s.dark : s.light;
};

export const Sidebar: React.FC<SidebarProps> = ({ onToggle }) => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const addNotification = useNotificationStore((state) => state.add);
  const { isConnected, joinRoom } = useSocketStore();
  const {
    rooms,
    loadRooms,
    createRoom,
    deleteRoom,
    currentRoom,
    unreadCounts,
    markRoomAsRead,
  } = useChatStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<string | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myRole, setMyRole] = useState<string>("MEMBER");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteStatus, setInviteStatus] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  const getUserTypeLabel = (userType: string) => {
    switch (userType) {
      case "HUMAN":
        return t("chat.userType.human");
      case "AI_AGENT":
        return t("chat.userType.ai_agent");
      case "AI_ICE":
        return t("chat.userType.ai_ice");
      case "AI_LAVA":
        return t("chat.userType.ai_lava");
      case "AI_OTHER":
        return t("chat.userType.ai_other");
      default:
        return userType.replace("AI_", "");
    }
  };

  // Load rooms on mount
  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Load participants — called on room change + every 10s for reactivity
  const loadParticipants = useCallback(
    async (roomId: string) => {
      try {
        const token = localStorage.getItem("triologue_token");
        const res = await fetch(`/api/rooms/${roomId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const room = await res.json();
          const parts: Participant[] = room.participants ?? [];
          setParticipants(parts);
          const me = parts.find((p) => p.username === user?.username);
          setMyRole(me?.role ?? "MEMBER");
        }
      } catch {
        /* silent */
      }
    },
    [user?.username],
  );

  useEffect(() => {
    if (!currentRoom) return;
    loadParticipants(currentRoom.id);
    
    // Mark room as read when entering (fixes mobile double-tap issue)
    markRoomAsRead(currentRoom.id);
    
    // Poll every 10s for reactivity (no socket event for joins yet)
    pollRef.current = setInterval(
      () => loadParticipants(currentRoom.id),
      10_000,
    );
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentRoom?.id, loadParticipants, markRoomAsRead]);

  const canInvite =
    ["OWNER", "ADMIN"].includes(myRole) || user?.isAdmin;

  const formatRoomActivityTime = useCallback((timestamp?: string) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
    if (sameDay) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(undefined, sameYear
      ? { day: "2-digit", month: "2-digit" }
      : { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
  }, []);

  const getRoomPreview = useCallback((room: (typeof rooms)[number]) => {
    const content = room.lastMessage?.content?.replace(/\s+/g, " ").trim();
    if (content) {
      const senderName = room.lastMessage?.sender?.displayName
        || room.lastMessage?.sender?.username;
      return senderName ? `${senderName}: ${content}` : content;
    }
    return room.description || t("chat.defaultRoom.desc");
  }, [t]);

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => {
      const aTs = Date.parse(a.lastMessage?.timestamp ?? "");
      const bTs = Date.parse(b.lastMessage?.timestamp ?? "");
      const safeATs = Number.isFinite(aTs) ? aTs : 0;
      const safeBTs = Number.isFinite(bTs) ? bTs : 0;
      if (safeBTs !== safeATs) return safeBTs - safeATs;
      return a.name.localeCompare(b.name);
    });
  }, [rooms]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim() || !currentRoom) return;
    setIsInviting(true);
    setInviteStatus(null);
    try {
      const token = localStorage.getItem("triologue_token");
      const res = await fetch(`/api/rooms/${currentRoom.id}/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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
        loadParticipants(currentRoom.id); // immediate refresh
        setTimeout(() => {
          setInviteStatus(null);
          setShowInvite(false);
        }, 2500);
      } else {
        const msg =
          res.status === 403
            ? t("chat.invite.noPermission")
            : res.status === 404
              ? t("chat.invite.notFound")
              : res.status === 409
                ? t("chat.invite.alreadyMember")
                : data.error ?? t("chat.invite.error");
        setInviteStatus({ type: "err", msg });
      }
    } catch {
      setInviteStatus({ type: "err", msg: t("chat.networkError") });
    } finally {
      setIsInviting(false);
    }
  };

  const handleCreateRoom = async (
    name: string,
    description: string,
    roomType: string,
    isPrivate: boolean,
  ) => {
    const room = await createRoom(name, description, roomType, isPrivate);
    if (room) {
      if (room.projectId) {
        const text = t("chat.notice.projectCreatedFromRoom")
          .replace("{projectId}", room.projectId);
        toast.success(
          text,
        );
        addNotification({
          type: "success",
          title: t("notifications.roomCreatedTitle"),
          message: text,
          link: `/projects/${room.projectId}`,
        });
      }
      // Join via socket & navigate
      joinRoom(room.id);
      navigate(`/room/${room.id}`);
    } else {
      throw new Error(t("chat.createFailed"));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Connection Status — only show when disconnected */}
      {!isConnected && (
        <div className={`p-3 ${theme === "dark" ? "border-b border-gray-800/60" : "border-b border-gray-200/60"}`}>
          <div
            className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${
              theme === "dark" ? "bg-red-900/30 border border-red-700/50" : "bg-red-50 border border-red-300"
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className={`text-xs font-medium ${
              theme === "dark" ? "text-red-200" : "text-red-700"
            }`}>
              {t("chat.connection.disconnected")}
            </span>
          </div>
        </div>
      )}

      {/* Rooms */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Rooms header with + button */}
          <div className="flex items-center justify-between mb-2">
            <h2
              className={`text-xs font-semibold uppercase tracking-wide ${theme === "dark" ? "text-gray-500" : "text-gray-600"}`}
            >
              {t("chat.rooms")}
            </h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className={`p-1 rounded-md transition-all duration-200 ${theme === "dark" ? "text-gray-400 hover:text-white hover:bg-gray-700" : "text-gray-500 hover:text-gray-900 hover:bg-gray-200"}`}
              title={t("chat.createRoom")}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {rooms.length === 0 ? (
              /* Fallback: always show main room */
              <Link
                to="/room/main-triologue"
                className="flex items-center gap-3 p-3 rounded-lg bg-blue-900/30 border border-blue-700 hover:bg-blue-900/50 transition-all duration-200"
              >
                <span className="flex-shrink-0"><UserGroupIcon className="w-4 h-4" /></span>
                <div className="flex-1">
                  <div className="font-medium text-sm">{t("chat.defaultRoom.name")}</div>
                  <div className="text-xs text-gray-400">{t("chat.defaultRoom.desc")}</div>
                </div>
              </Link>
            ) : (
              sortedRooms.map((room) => {
                const PROTECTED = ["main-triologue"];
                const canDelete = !PROTECTED.includes(room.id);
                const unread = unreadCounts[room.id] ?? 0;
                const isActive = currentRoom?.id === room.id;
                const hasUnread = unread > 0 && !isActive;
                const activityTime = formatRoomActivityTime(room.lastMessage?.timestamp);
                const preview = getRoomPreview(room);
                return (
                  <div
                    key={room.id}
                    className={`flex items-center gap-1 rounded-lg transition-all duration-200 group ${
                      isActive
                        ? "bg-blue-950/30 border border-blue-700/40"
                        : hasUnread
                          ? "bg-blue-950/20 border border-blue-800/30 hover:bg-blue-900/30"
                          : theme === "dark"
                            ? "hover:bg-gray-800/40"
                            : "hover:bg-gray-100"
                    }`}
                  >
                    <Link
                      to={`/room/${room.id}`}
                      className="flex items-center gap-3 p-3 flex-1 min-w-0"
                    >
                      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">
                        {ROOM_TYPE_ICONS[room.roomType] ?? <ChatBubbleLeftRightIcon className="w-4 h-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm truncate ${hasUnread ? "font-bold text-white" : "font-medium"}`}
                          >
                            {room.name}
                          </span>
                          {room.isPrivate && (
                            <LockClosedIcon className="w-3 h-3 text-gray-500 flex-shrink-0 opacity-60" />
                          )}
                          {activityTime && (
                            <span className={`ml-auto text-[11px] flex-shrink-0 ${hasUnread ? "text-blue-200" : "text-gray-500"}`}>
                              {activityTime}
                            </span>
                          )}
                        </div>
                        <div className={`text-xs truncate ${hasUnread ? "text-blue-100" : "text-gray-400"}`}>
                          {preview}
                        </div>
                      </div>
                      {hasUnread && (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1 bg-blue-500/80 text-white text-xs rounded-full flex items-center justify-center font-medium leading-none">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Link>
                    {/* Delete button — hover only, not for protected rooms */}
                    {canDelete && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setRoomToDelete({ id: room.id, name: room.name });
                        }}
                        disabled={deletingRoom === room.id}
                        className="opacity-0 group-hover:opacity-100 mr-2 p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-all flex-shrink-0 disabled:opacity-30"
                        title={t("nav.deleteRoom.title")}
                        aria-label={t("nav.deleteRoom.title")}
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Participants Section */}
        <div
          className={`p-4 ${theme === "dark" ? "border-t border-gray-800/60" : "border-t border-gray-200/60"}`}
        >
          {/* Header with + button for owners */}
          <div className="flex items-center justify-between mb-3">
            <h2
              className={`text-xs font-semibold uppercase tracking-wide ${theme === "dark" ? "text-gray-500" : "text-gray-600"}`}
            >
              {t("chat.participants")} ({participants.length})
            </h2>
            {canInvite && (
              <button
                onClick={() => {
                  setShowInvite((v) => !v);
                  setInviteStatus(null);
                  setInviteUsername("");
                }}
                className={`w-5 h-5 flex items-center justify-center rounded transition-all duration-200 text-sm leading-none ${theme === "dark" ? "bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-900"}`}
                title={t("chat.addParticipant")}
              >
                {showInvite ? "✕" : "+"}
              </button>
            )}
          </div>

          {/* Inline invite form */}
          {showInvite && canInvite && (
            <form
              onSubmit={handleInvite}
              className="mb-3 flex flex-col gap-1.5"
            >
              <label className={`text-xs font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                {t("chat.usernamePlaceholder")} <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={inviteUsername}
                onChange={(e) => {
                  setInviteUsername(e.target.value);
                  setInviteStatus(null);
                }}
                placeholder={t("chat.usernamePlaceholder")}
                className={`w-full px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 transition-all duration-200 ${theme === "dark" ? "bg-gray-700/80 border border-gray-600/50 text-white placeholder-gray-400" : "bg-white border border-gray-300/60 text-gray-900 placeholder-gray-500 shadow-subtle"}`}
                required
              />
              <button
                type="submit"
                disabled={isInviting || !inviteUsername.trim()}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 shadow-subtle disabled:opacity-40 rounded text-xs font-medium transition-all duration-200"
              >
                {isInviting ? t("chat.adding") : t("chat.add")}
              </button>
              {inviteStatus && (
                <p
                  className={`text-xs ${inviteStatus.type === "ok" ? "text-green-400" : "text-red-400"}`}
                >
                  {inviteStatus.msg}
                </p>
              )}
            </form>
          )}

          {/* Participant list */}
          <div className="space-y-1 max-h-44 overflow-y-auto scrollbar-hide">
            {participants.map((p) => (
              <div
                key={p.userId}
                className="flex items-center gap-2 p-1.5 rounded-lg"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${getAvatarStyle(p.userType, theme)}`}
                >
                  {getParticipantIcon(p.userType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs truncate flex items-center gap-1">
                    {p.displayName}
                    {p.role === "OWNER" && (
                      <span className="text-yellow-400 text-[10px]">&#9733;</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {getUserTypeLabel(p.userType)}
                  </div>
                </div>
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    (p.presenceStatus || (p.isOnline ? 'online' : 'offline')) === 'online'
                      ? "bg-green-400"
                      : (p.presenceStatus || (p.isOnline ? 'online' : 'offline')) === 'active'
                        ? "bg-yellow-400"
                        : "bg-gray-600"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* User menu moved to global Navbar */}

      {/* Create Room Modal */}
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateRoom}
        />
      )}

      <ConfirmDialog
        open={!!roomToDelete}
        title={t("nav.deleteRoom.title")}
        message={t("nav.deleteRoom.message").replace(
          "{name}",
          roomToDelete?.name ?? "",
        )}
        confirmLabel={t("nav.deleteConfirm")}
        cancelLabel={t("nav.deleteCancel")}
        variant="danger"
        loading={deletingRoom === roomToDelete?.id}
        onConfirm={async () => {
          if (!roomToDelete) return;
          setDeletingRoom(roomToDelete.id);
          const ok = await deleteRoom(roomToDelete.id);
          setDeletingRoom(null);
          setRoomToDelete(null);
          if (ok && currentRoom?.id === roomToDelete.id) navigate("/");
        }}
        onCancel={() => setRoomToDelete(null)}
      />
    </div>
  );
};
