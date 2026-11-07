import { create } from "zustand";
import { useAuthStore } from "./authStore";
import { apiClient } from "../lib/apiClient";

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface MessageAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  type:
    | "IMAGE"
    | "DOCUMENT"
    | "CODE_SNIPPET"
    | "RESEARCH_DATA"
    | "MEMORY_EXPORT";
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  roomId: string;
  /** Set on a thread reply; those live in the thread panel, not in the room list. */
  threadId?: string | null;
  messageType?: string;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
    avatar?: string;
  };
  reactions: MessageReaction[];
  attachments?: MessageAttachment[];
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: { id: string; username: string; displayName: string } | null;
}

interface RoomLastMessage {
  id: string;
  content: string;
  sender?: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
  } | null;
  timestamp: string;
}

interface Room {
  id: string;
  name: string;
  description?: string;
  roomType: string;
  isPrivate?: boolean;
  projectId?: string;
  linkedProjectStatus?: string | null;
  canSendMessages?: boolean;
  role?: string;
  lastMessage?: RoomLastMessage | null;
}

interface ChatState {
  currentRoom: Room | null;
  currentRoomId: string | null; // Set immediately on room switch, before API response
  messages: Message[];
  rooms: Room[];
  isLoading: boolean;
  messagesError: boolean;
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  /** Oldest message id fetched so far, replies included: the paging cursor. */
  oldestFetchedId: string | null;
  unreadCounts: Record<string, number>;
  loadRoom: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string) => Promise<void>;
  loadMoreMessages: (roomId: string) => Promise<void>;
  loadRooms: () => Promise<void>;
  createRoom: (
    name: string,
    description: string,
    roomType: string,
    isPrivate: boolean,
  ) => Promise<Room | null>;
  deleteRoom: (roomId: string) => Promise<boolean>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (messageId: string) => void;
  addReaction: (messageId: string, reaction: MessageReaction) => void;
  removeReaction: (messageId: string, emoji: string, userId: string) => void;
  incrementUnread: (roomId: string) => void;
  markRoomAsRead: (roomId: string) => void;
  setRoomLastMessage: (roomId: string, lastMessage: RoomLastMessage) => void;
  pinMessage: (messageId: string, pinnedAt: string, pinnedBy: { id: string; username: string; displayName: string }) => void;
  unpinMessage: (messageId: string) => void;
}

/**
 * The room list shows top-level messages only. GET /api/messages/:roomId
 * returns thread replies too, and a live reply arrives as `message:new` with a
 * threadId; both are kept out of `messages` here, the one place that decides.
 */
export const isTopLevelMessage = (message: { threadId?: string | null }): boolean =>
  !message.threadId;

/** Pages one call may fetch while they hold nothing but thread replies. */
export const MAX_PAGES_PER_CALL = 5;
const PAGE_SIZE = 50;

interface PagedMessages {
  /** Top-level messages of the fetched pages, oldest first. */
  messages: Message[];
  /** Oldest message id fetched, replies included (null when nothing came). */
  oldestFetchedId: string | null;
  hasMore: boolean;
}

/**
 * Fetches the room's messages from `cursor` (null: the newest page) backwards,
 * and keeps going while the pages hold only thread replies (nothing to show),
 * at most MAX_PAGES_PER_CALL pages per call and until the server has no more.
 * A first page that fails is "error"; a later one ends the call with hasMore
 * still true, so the caller's "load older" can continue.
 */
async function fetchTopLevelPages(
  roomId: string,
  cursor: string | null,
  isCurrent: () => boolean,
): Promise<PagedMessages | "error"> {
  let before = cursor;
  let shown: Message[] = [];
  let oldest: string | null = null;
  let hasMore = false;
  for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
    const url = before
      ? `/api/messages/${roomId}?limit=${PAGE_SIZE}&before=${before}`
      : `/api/messages/${roomId}?limit=${PAGE_SIZE}`;
    let response: Response;
    try {
      response = await apiClient(url);
    } catch (error) {
      if (page === 0) throw error;
      hasMore = true;
      break;
    }
    if (!isCurrent()) return { messages: [], oldestFetchedId: null, hasMore: false };
    if (!response.ok) {
      if (page === 0) {
        console.error("Failed to load messages:", response.status);
        return "error";
      }
      hasMore = true;
      break;
    }
    const data = await response.json();
    const raw: Message[] = Array.isArray(data) ? data : (data.messages ?? data);
    hasMore = data.hasMore ?? raw.length >= PAGE_SIZE;
    if (raw.length === 0) {
      hasMore = false;
      break;
    }
    oldest = raw[0].id;
    before = oldest;
    shown = [...raw.filter(isTopLevelMessage), ...shown];
    if (shown.length > 0 || !hasMore) break;
  }
  return { messages: shown, oldestFetchedId: oldest, hasMore };
}

let loadRoomsInFlight: Promise<void> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (retryAfter: string | null): number => {
  if (!retryAfter) return 0;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const absoluteTime = Date.parse(retryAfter);
  if (!Number.isNaN(absoluteTime)) return Math.max(absoluteTime - Date.now(), 0);
  return 0;
};

export const useChatStore = create<ChatState>((set, get) => ({
  currentRoom: null,
  currentRoomId: null,
  messages: [],
  rooms: [],
  isLoading: false,
  messagesError: false,
  isLoadingMore: false,
  hasMoreMessages: false,
  oldestFetchedId: null,
  unreadCounts: {},

  loadRoom: async (roomId: string) => {
    // Set currentRoomId immediately so socket messages aren't dropped while API loads
    set({ currentRoomId: roomId });
    try {
      const response = await apiClient(`/api/rooms/${roomId}`);

      if (response.ok) {
        const room = await response.json();
        set({ currentRoom: room });
      }
    } catch (error) {
      console.error("Failed to load room:", error);
      set({
        currentRoom: {
          id: roomId,
          name: "Main OpenTriologue",
          description: "🧊🌋👨‍💻 AI-to-AI-to-Human Chat",
          roomType: "TRIOLOGUE",
        },
      });
    }
  },

  loadMessages: async (roomId: string) => {
    // Mark as read immediately when entering a room
    set((state) => ({
      isLoading: true,
      messagesError: false,
      messages: [],
      hasMoreMessages: false,
      oldestFetchedId: null,
      currentRoomId: roomId,
      unreadCounts: { ...state.unreadCounts, [roomId]: 0 },
    }));
    const isCurrent = () => get().currentRoomId === roomId;
    try {
      const result = await fetchTopLevelPages(roomId, null, isCurrent);
      if (!isCurrent()) return;
      if (result === "error") {
        set({ messagesError: true });
      } else {
        console.log("✅ Loaded messages:", result.messages.length);
        set({
          messages: result.messages,
          oldestFetchedId: result.oldestFetchedId,
          hasMoreMessages: result.hasMore,
        });
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
      if (isCurrent()) set({ messagesError: true });
    } finally {
      if (isCurrent()) set({ isLoading: false });
    }
  },

  loadMoreMessages: async (roomId: string) => {
    const { messages, isLoadingMore, oldestFetchedId } = get();
    if (isLoadingMore) return;
    // Page from the oldest fetched message, not the oldest shown one: a page
    // made only of thread replies shows nothing new, and paging from the
    // shown message would ask for the same page again.
    const oldestId = oldestFetchedId ?? messages[0]?.id;
    if (!oldestId) return;
    set({ isLoadingMore: true });
    const isCurrent = () => get().currentRoomId === roomId;
    try {
      const result = await fetchTopLevelPages(roomId, oldestId, isCurrent);
      if (result !== "error" && isCurrent()) {
        set((state) => ({
          messages: [...result.messages, ...state.messages],
          oldestFetchedId: result.oldestFetchedId ?? state.oldestFetchedId,
          hasMoreMessages: result.hasMore,
        }));
      }
    } catch (error) {
      console.error("Failed to load more messages:", error);
    } finally {
      set({ isLoadingMore: false });
    }
  },

  incrementUnread: (roomId: string) => {
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: (state.unreadCounts[roomId] ?? 0) + 1,
      },
    }));
  },

  markRoomAsRead: (roomId: string) => {
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [roomId]: 0 },
    }));
  },

  setRoomLastMessage: (roomId: string, lastMessage: RoomLastMessage) => {
    set((state) => {
      const rooms = state.rooms.map((room) => {
        if (room.id !== roomId) return room;
        const currentTs = Date.parse(room.lastMessage?.timestamp ?? "");
        const nextTs = Date.parse(lastMessage.timestamp);
        if (
          Number.isFinite(currentTs) &&
          Number.isFinite(nextTs) &&
          nextTs < currentTs
        ) {
          return room;
        }
        return { ...room, lastMessage };
      });
      return { rooms };
    });
  },

  loadRooms: async () => {
    if (loadRoomsInFlight) return loadRoomsInFlight;

    loadRoomsInFlight = (async () => {
      try {
        const token = useAuthStore.getState().token;
        if (!token) {
          set({ rooms: [] });
          return;
        }

        const response = await apiClient("/api/rooms?include=lastMessage");

        if (response.ok) {
          const rooms = await response.json();
          set({ rooms });
          return;
        }

        if (response.status === 429) {
          const retryDelay = Math.min(
            Math.max(parseRetryAfterMs(response.headers.get("Retry-After")), 500),
            5000,
          );
          await sleep(retryDelay);

          const retryResponse = await apiClient("/api/rooms?include=lastMessage");
          if (retryResponse.ok) {
            const rooms = await retryResponse.json();
            set({ rooms });
            return;
          }
          if (retryResponse.status === 401 || retryResponse.status === 403) {
            set({ rooms: [] });
            return;
          }
          throw new Error(`loadRooms failed after retry with status ${retryResponse.status}`);
        }

        if (response.status === 401 || response.status === 403) {
          set({ rooms: [] });
          return;
        }

        throw new Error(`loadRooms failed with status ${response.status}`);
      } catch (error) {
        console.error("Failed to load rooms:", error);
        set({
          rooms: [
            {
              id: "main-triologue",
              name: "Main OpenTriologue",
              roomType: "TRIOLOGUE",
            },
          ],
        });
      }
    })().finally(() => {
      loadRoomsInFlight = null;
    });

    return loadRoomsInFlight;
  },

  createRoom: async (
    name: string,
    description: string,
    roomType: string,
    isPrivate: boolean,
  ): Promise<Room | null> => {
    try {
      const response = await apiClient("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name, description, roomType, isPrivate }),
      });

      if (response.ok) {
        const room = await response.json();
        // Add to rooms list immediately
        set((state) => ({ rooms: [...state.rooms, room] }));
        return room;
      } else {
        const err = await response.json().catch(() => ({}));
        console.error("Failed to create room:", err);
        return null;
      }
    } catch (error) {
      console.error("Failed to create room:", error);
      return null;
    }
  },

  deleteRoom: async (roomId: string) => {
    try {
      const res = await apiClient(`/api/rooms/${roomId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete room");
      }
      set((state) => ({ rooms: state.rooms.filter((r) => r.id !== roomId) }));
      return true;
    } catch (err) {
      console.error("Failed to delete room:", err);
      return false;
    }
  },

  addMessage: (message: Message) => {
    if (!isTopLevelMessage(message)) return;
    set((state) => {
      if (state.messages.some((m) => m.id === message.id)) return state;
      return { messages: [...state.messages, message] };
    });
  },

  updateMessage: (messageId: string, updates: Partial<Message>) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg,
      ),
    }));
  },

  deleteMessage: (messageId: string) => {
    set((state) => ({
      messages: state.messages.filter((msg) => msg.id !== messageId),
    }));
  },

  addReaction: (messageId: string, reaction: MessageReaction) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        // Avoid duplicates
        const already = msg.reactions.some(
          (r) => r.emoji === reaction.emoji && r.userId === reaction.userId,
        );
        if (already) return msg;
        return { ...msg, reactions: [...msg.reactions, reaction] };
      }),
    }));
  },

  removeReaction: (messageId: string, emoji: string, userId: string) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          reactions: msg.reactions.filter(
            (r) => !(r.emoji === emoji && r.userId === userId),
          ),
        };
      }),
    }));
  },

  pinMessage: (messageId: string, pinnedAt: string, pinnedBy: { id: string; username: string; displayName: string }) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, isPinned: true, pinnedAt, pinnedBy }
          : msg,
      ),
    }));
  },

  unpinMessage: (messageId: string) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, isPinned: false, pinnedAt: undefined, pinnedBy: null }
          : msg,
      ),
    }));
  },
}));
