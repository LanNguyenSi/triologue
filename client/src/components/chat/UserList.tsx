import React, { useEffect, useState, useCallback } from "react";
import { ArrowPathIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import toast from "react-hot-toast";
import { useAuthStore } from "../../stores/authStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { InvitePopup } from "./InvitePopup";
import { useNotificationStore } from "../../stores/notificationStore";
import { apiClient } from "../../lib/apiClient";
import { useSocketStore, type AgentPresenceEvent } from "../../stores/socketStore";
import { getAvatarStyle, getAvatarIcon } from "./chatUtils";

type PresenceStatus = "online" | "active" | "offline" | "working" | "waiting" | "error";

interface PresenceMeta {
  host: string | null;
  project: string | null;
  sessionId: string | null;
  detail: string | null;
  sessions: number;
  updatedAt: string;
  expiresAt: string;
}

interface Participant {
  userId: string;
  username: string;
  displayName: string;
  userType: string;
  role: string;
  isOnline: boolean;
  presenceStatus?: PresenceStatus;
  /** Present for agents whose gateway reported a session status. */
  presenceMeta?: PresenceMeta;
}

/** The server's agent status vocabulary mapped onto the participant dot. */
const agentStatusToPresence = (status: AgentPresenceEvent["status"]): PresenceStatus => {
  switch (status) {
    case "working":
      return "working";
    case "waiting_approval":
      return "waiting";
    case "error":
      return "error";
    case "offline":
      return "offline";
    default:
      return "online";
  }
};

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-green-400",
  active: "bg-yellow-400",
  working: "bg-blue-400 animate-pulse",
  waiting: "bg-orange-400",
  error: "bg-red-500",
  offline: "bg-gray-600",
};

/**
 * `setTimeout` fires immediately once its delay is above 2^31-1 ms, so a later
 * expiry is clamped to this and the timer re-arms when it fires.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The status to show: a live `agent:presence` event wins when it is newer
 * than the details the room load reported; when the load reported none,
 * only a live event still within its TTL counts (a status whose writer
 * died is dropped by the server after the TTL and must not outlive that on
 * screen). Otherwise the loaded status, otherwise the socket flag.
 */
function resolvePresence(
  p: Participant,
  live: AgentPresenceEvent | undefined,
  now: number = Date.now(),
): { status: PresenceStatus; meta: PresenceMeta | null } {
  const loadedMeta = p.presenceMeta ?? null;
  if (live) {
    const fresh = live.status !== "offline" && Date.parse(live.expiresAt) > now;
    const applies = loadedMeta ? live.updatedAt >= loadedMeta.updatedAt : fresh;
    if (applies) {
      return {
        status: agentStatusToPresence(live.status),
        meta: live.status === "offline"
          ? null
          : { host: live.host, project: live.project, sessionId: live.sessionId, detail: live.detail, sessions: live.sessions, updatedAt: live.updatedAt, expiresAt: live.expiresAt },
      };
    }
  }
  return {
    status: p.presenceStatus ?? (p.isOnline ? "online" : "offline"),
    meta: loadedMeta,
  };
}

interface UserListProps {
  roomId: string;
}

const getRoleBadge = (role: string) => {
  if (role === "OWNER")
    return <span className="text-[10px] text-yellow-400 ml-1">&#9733;</span>;
  if (role === "ADMIN")
    return <span className="text-[10px] text-blue-400 ml-1">&#9670;</span>;
  return null;
};

export const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const { user: currentUser } = useAuthStore();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const addNotification = useNotificationStore((state) => state.add);
  const agentPresence = useSocketStore((state) => state.agentPresence);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myRole, setMyRole] = useState<string>("MEMBER");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const presenceLabel = (status: PresenceStatus, meta: PresenceMeta | null) => {
    const label = t(`chat.presence.${status}`);
    const parts = [label];
    if (meta?.host) parts.push(meta.host);
    if (meta?.project) parts.push(meta.project);
    if (meta?.detail) parts.push(meta.detail);
    return parts.join(" · ");
  };

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

  const load = useCallback(async () => {
    try {
      const res = await apiClient(`/api/rooms/${roomId}`);
      if (res.ok) {
        const room = await res.json();
        const parts: Participant[] = room.participants ?? [];
        setParticipants(parts);
        // Find current user's role
        const me = parts.find((p) => p.username === currentUser?.username);
        if (me) setMyRole(me.role);
      }
    } catch (e) {
      console.error("Failed to load participants:", e);
    }
  }, [roomId, currentUser?.username]);

  useEffect(() => {
    load();
  }, [load]);

  // A live status is only shown while it is within its TTL, and nothing else
  // re-renders this list, so one timer at the earliest expiry among the live
  // statuses on screen forces the re-evaluation that drops it: without it a
  // status whose writer died stays on screen until some other event arrives.
  // `presenceTick` is a dependency so a clamped timer for a far-future expiry
  // re-arms itself instead of leaving the status unscheduled.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const pending: number[] = [];
    for (const p of participants) {
      const live = agentPresence[p.userId];
      // Only a status whose display depends on freshness needs a timer: with
      // loaded details a live event wins on updatedAt and its expiry changes
      // nothing, an offline event is never shown, and an expiry already past
      // has fallen back already.
      if (!live || live.status === "offline" || p.presenceMeta) continue;
      const expiresIn = Date.parse(live.expiresAt);
      // An unparsable expiresAt is treated as expired by resolvePresence, so
      // a timer for it would only spin; NaN never reaches setTimeout.
      if (Number.isNaN(expiresIn) || expiresIn <= now) continue;
      pending.push(expiresIn - now);
    }
    if (pending.length === 0) return;
    const delay = Math.min(...pending.map((ms) => Math.min(ms, MAX_TIMER_MS)));
    const timer = setTimeout(() => setPresenceTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [participants, agentPresence, presenceTick]);

  const canInvite =
    ["OWNER", "ADMIN", "MODERATOR"].includes(myRole) || currentUser?.isAdmin;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;
    setIsInviting(true);
    setInviteError("");
    setInviteSuccess("");
    try {
      const res = await apiClient(`/api/rooms/${roomId}/invite`, {
        method: "POST",
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteSuccess(
          t("chat.addedSuccess").replace("{username}", data.invitedUser),
        );
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
        setTimeout(() => setInviteSuccess(""), 3000);
        load(); // refresh participants
      } else {
        const msg =
          res.status === 403
            ? t("chat.invite.noPermission")
            : res.status === 404
              ? t("chat.invite.notFound")
              : res.status === 409
                ? t("chat.invite.alreadyMember")
                : data.error ?? t("chat.invite.error");
        setInviteError(msg);
      }
    } catch {
      setInviteError(t("chat.networkError"));
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Header */}
      <h3
        className={`text-sm font-semibold mb-2 uppercase tracking-wide ${
          theme === "dark" ? "text-gray-400" : "text-gray-600"
        }`}
      >
        {t("chat.participants")} ({participants.length})
      </h3>

      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => load()}
          className={`inline-flex items-center justify-center rounded-lg p-1.5 text-xs transition-colors duration-200 shrink-0 ${
            theme === "dark"
              ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
              : "bg-gray-100 hover:bg-gray-200 text-gray-700"
          }`}
          title={t("chat.toolbox.refresh")}
          aria-label={t("chat.toolbox.refresh")}
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
          <span className="sr-only">{t("chat.toolbox.refresh")}</span>
        </button>

        {canInvite && (
          <button
            type="button"
            onClick={() => {
              setShowInviteForm((v) => !v);
              setInviteError("");
              setInviteSuccess("");
            }}
            className={`inline-flex items-center justify-center rounded-lg p-1.5 text-xs transition-colors duration-200 shrink-0 ${
              showInviteForm
                ? theme === "dark"
                  ? "bg-blue-900/40 text-blue-300"
                  : "bg-blue-100 text-blue-700"
                : theme === "dark"
                  ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            }`}
            title={t("chat.addParticipant")}
            aria-label={t("chat.addParticipant")}
          >
            <UserPlusIcon className="w-3.5 h-3.5" />
            <span className="sr-only">{t("chat.addParticipant")}</span>
          </button>
        )}

        <div className="ml-auto" />
      </div>

      {/* Participant list */}
      <div className="space-y-2 flex-1 overflow-y-auto scrollbar-hide">
        {participants.map((p) => {
          const avatar = getAvatarStyle(p.userType, theme, p.userId);
          const presence = resolvePresence(p, agentPresence[p.userId]);
          return (
          <div
            key={p.userId}
            className={`flex items-center gap-3 p-2 rounded-lg transition-colors duration-200 ${
              theme === "dark" ? "hover:bg-gray-700/60" : "hover:bg-gray-100"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${avatar.className}`}
              style={avatar.style}
            >
              {getAvatarIcon(p.userType, p.userId)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm flex items-center gap-1 truncate">
                {p.displayName}
                {getRoleBadge(p.role)}
              </div>
              <div
                className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
              >
                {getUserTypeLabel(p.userType)}
              </div>
            </div>
            <div
              role="img"
              title={presenceLabel(presence.status, presence.meta)}
              aria-label={presenceLabel(presence.status, presence.meta)}
              data-presence={presence.status}
              className={`w-2 h-2 rounded-full shrink-0 ${PRESENCE_DOT[presence.status]}`}
            />
          </div>
          );
        })}
      </div>

      {/* Invite by username (owner/admin only) */}
      {canInvite && showInviteForm && (
        <div
          className={`mt-4 pt-4 border-t ${theme === "dark" ? "border-gray-700/50" : "border-gray-300/60"}`}
        >
          <p
            className={`text-xs mb-2 uppercase tracking-wide ${
              theme === "dark" ? "text-gray-400" : "text-gray-600"
            }`}
          >
            {t("chat.addParticipant")}
          </p>
          <form onSubmit={handleInvite} className="flex flex-col gap-2">
            <label className={`text-xs font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
              {t("chat.usernamePlaceholder")} <span className={theme === "dark" ? "text-red-400" : "text-red-600"}>*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={inviteUsername}
                onChange={(e) => {
                  setInviteUsername(e.target.value);
                  setInviteError("");
                }}
                placeholder={t("chat.usernamePlaceholder")}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-hidden focus:ring-1 focus:ring-blue-500/40 focus:ring-offset-1 ${theme === "dark" ? "focus:ring-offset-gray-900" : "focus:ring-offset-white"} transition-colors duration-200 ${
                  theme === "dark"
                    ? "bg-gray-700/80 border-gray-600/50 text-white placeholder-gray-400"
                    : "bg-white border-gray-200/60 text-gray-900 placeholder-gray-500 shadow-subtle"
                }`}
                required
              />
              <InvitePopup
                roomId={roomId}
                query={inviteUsername}
                visible={showInviteForm && inviteUsername.length > 0}
                onSelect={(username) => {
                  setInviteUsername(username);
                  setInviteError("");
                }}
              />
            </div>
            <button
              type="submit"
              disabled={isInviting || !inviteUsername.trim()}
              className="w-full py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors duration-200 shadow-subtle"
            >
              {isInviting ? t("chat.adding") : t("chat.add")}
            </button>
            {inviteError && (
              <p className={`text-xs ${theme === "dark" ? "text-red-400" : "text-red-600"}`}>{inviteError}</p>
            )}
            {inviteSuccess && (
              <p className="text-xs text-green-400">{inviteSuccess}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
