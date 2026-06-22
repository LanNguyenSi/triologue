import { useLocation } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';

export const PROTECTED_ROOMS = ['main-triologue', 'onboarding'];

/** Minimal structural shape of a room used by the sidebar list utilities. */
export interface RoomLike {
  id: string;
  name: string;
  description?: string | null;
  isPrivate?: boolean;
  role?: string;
  lastMessage?: {
    content?: string | null;
    timestamp?: string;
    sender?: { displayName?: string | null; username?: string | null } | null;
  } | null;
}

/** Activity time: HH:MM today, DD.MM this year, DD.MM.YY older; '' when missing/invalid. */
export function formatRoomActivityTime(timestamp?: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(
    undefined,
    sameYear
      ? { day: '2-digit', month: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: '2-digit' },
  ).format(date);
}

/** "Sender: message" preview (whitespace-collapsed), falling back to the room description. */
export function getRoomPreview(room: RoomLike): string {
  const content = room.lastMessage?.content?.replace(/\s+/g, ' ').trim();
  if (content) {
    const sender =
      room.lastMessage?.sender?.displayName || room.lastMessage?.sender?.username;
    return sender ? `${sender}: ${content}` : content;
  }
  return room.description || '';
}

/** Sort by last-message time desc, then name asc. Missing/invalid timestamps sort last. */
export function sortRooms<T extends RoomLike>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => {
    const aTs = Date.parse(a.lastMessage?.timestamp ?? '');
    const bTs = Date.parse(b.lastMessage?.timestamp ?? '');
    const safeATs = Number.isFinite(aTs) ? aTs : 0;
    const safeBTs = Number.isFinite(bTs) ? bTs : 0;
    if (safeBTs !== safeATs) return safeBTs - safeATs;
    return a.name.localeCompare(b.name);
  });
}

/** Sort then filter by a free-text query over name + description + preview. */
export function selectVisibleRooms<T extends RoomLike>(rooms: T[], query: string): T[] {
  const sorted = sortRooms(rooms);
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sorted;
  return sorted.filter((room) => {
    const searchable =
      `${room.name} ${room.description ?? ''} ${getRoomPreview(room)}`.toLowerCase();
    return searchable.includes(normalized);
  });
}

/**
 * Room-list data for the sidebar. The search query is owned by the caller
 * (AppShell) so the mobile and desktop sidebars share one value, matching the
 * pre-decomposition behavior.
 */
export function useRoomList(roomSearchQuery: string) {
  const { rooms, unreadCounts, markRoomAsRead } = useChatStore();
  const location = useLocation();

  const currentRoomId = location.pathname.startsWith('/room/')
    ? location.pathname.split('/room/')[1]
    : null;

  const filteredRooms = selectVisibleRooms(rooms, roomSearchQuery);

  return {
    rooms,
    filteredRooms,
    getRoomPreview,
    formatRoomActivityTime,
    currentRoomId,
    unreadCounts,
    markRoomAsRead,
  };
}
