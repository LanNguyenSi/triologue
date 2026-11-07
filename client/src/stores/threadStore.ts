import { create } from "zustand";
import { apiClient } from "../lib/apiClient";
import type { Message, Thread } from "../types/chat";

/**
 * Threads of the open room: the list, the open thread with its replies, and
 * the panel view. The server routes are `/api/rooms/:roomId/threads` (create,
 * list, resolve) and `/api/rooms/:roomId/messages?threadId=` (the replies).
 * Live updates arrive through socketStore: `thread:created`, and `message:new`
 * with a threadId, which is routed here and never into the room list.
 */

export type ThreadPanelView = "closed" | "list" | "thread" | "draft";

/** Translation keys of the errors the panel can show; translated at render time. */
export type ThreadErrorKey =
  | "threads.resolveForbidden"
  | "threads.resolveFailed"
  | "threads.createFailed";

const LIST_LIMIT = 50;
const REPLY_LIMIT = 100;

/** Newest activity first; ties by id, descending (the server's order). */
export const sortThreads = (threads: Thread[]): Thread[] =>
  [...threads].sort((a, b) => {
    const byActivity = Date.parse(b.lastActivity) - Date.parse(a.lastActivity);
    if (byActivity) return byActivity;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });

const sortReplies = (replies: Message[]): Message[] =>
  [...replies].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (byTime) return byTime;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });

const upsertThread = (threads: Thread[], thread: Thread): Thread[] =>
  sortThreads([...threads.filter((t) => t.id !== thread.id), thread]);

const mergeReplies = (existing: Message[], incoming: Message[]): Message[] => {
  const byId = new Map<string, Message>();
  for (const reply of existing) byId.set(reply.id, reply);
  for (const reply of incoming) byId.set(reply.id, reply);
  return sortReplies([...byId.values()]);
};

interface ThreadState {
  roomId: string | null;
  threads: Thread[];
  threadsLoading: boolean;
  threadsError: boolean;
  hasMoreThreads: boolean;
  view: ThreadPanelView;
  activeThreadId: string | null;
  /** The message a new thread is being started from (view "draft"). */
  draftRoot: Message | null;
  replies: Message[];
  repliesLoading: boolean;
  repliesError: boolean;
  /** The last page of replies was full, so older ones may exist. */
  hasMoreReplies: boolean;
  /** Oldest reply id fetched for the open thread: the `before` cursor. */
  oldestReplyId: string | null;
  loadingOlderReplies: boolean;
  olderRepliesError: boolean;
  /** Reply ids already counted into a thread's messageCount (this room only). */
  countedReplyIds: Record<string, true>;
  creating: boolean;
  createError: ThreadErrorKey | null;
  resolving: boolean;
  resolveError: ThreadErrorKey | null;

  setRoom: (roomId: string) => void;
  loadThreads: (roomId: string) => Promise<void>;
  loadMoreThreads: () => Promise<void>;
  openList: () => void;
  closePanel: () => void;
  /** Open the thread rooted at the message, or start a draft for a new one. */
  replyInThread: (message: Message) => void;
  createThread: (title: string) => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  loadReplies: (threadId: string) => Promise<void>;
  loadOlderReplies: () => Promise<void>;
  setResolved: (threadId: string, isResolved: boolean) => Promise<void>;
  applyThreadCreated: (thread: Thread) => void;
  applyReply: (message: Message) => void;
  removeReply: (messageId: string) => void;
}

const emptyRoomState = {
  threads: [] as Thread[],
  threadsLoading: false,
  threadsError: false,
  hasMoreThreads: false,
  view: "closed" as ThreadPanelView,
  activeThreadId: null as string | null,
  draftRoot: null as Message | null,
  replies: [] as Message[],
  repliesLoading: false,
  repliesError: false,
  hasMoreReplies: false,
  oldestReplyId: null as string | null,
  loadingOlderReplies: false,
  olderRepliesError: false,
  countedReplyIds: {} as Record<string, true>,
  creating: false,
  createError: null as ThreadErrorKey | null,
  resolving: false,
  resolveError: null as ThreadErrorKey | null,
};

export const useThreadStore = create<ThreadState>((set, get) => ({
  roomId: null,
  ...emptyRoomState,

  setRoom: (roomId) => {
    if (get().roomId === roomId) return;
    set({ roomId, ...emptyRoomState });
  },

  loadThreads: async (roomId) => {
    set({ threadsLoading: true, threadsError: false });
    try {
      const res = await apiClient(`/api/rooms/${roomId}/threads?limit=${LIST_LIMIT}`);
      if (get().roomId !== roomId) return;
      if (!res.ok) {
        set({ threadsError: true });
        return;
      }
      const data: Thread[] = await res.json();
      const page = Array.isArray(data) ? data : [];
      set((state) => ({
        threads: sortThreads(
          page.reduce((acc, t) => upsertThread(acc, t), state.threads),
        ),
        hasMoreThreads: page.length >= LIST_LIMIT,
      }));
    } catch {
      if (get().roomId === roomId) set({ threadsError: true });
    } finally {
      if (get().roomId === roomId) set({ threadsLoading: false });
    }
  },

  loadMoreThreads: async () => {
    const { roomId, threads, threadsLoading } = get();
    if (!roomId || threadsLoading || threads.length === 0) return;
    // The server pages by the id of the last thread of the previous page.
    const before = threads[threads.length - 1].id;
    set({ threadsLoading: true, threadsError: false });
    try {
      const res = await apiClient(
        `/api/rooms/${roomId}/threads?limit=${LIST_LIMIT}&before=${encodeURIComponent(before)}`,
      );
      if (get().roomId !== roomId) return;
      if (!res.ok) {
        set({ threadsError: true });
        return;
      }
      const data: Thread[] = await res.json();
      const page = Array.isArray(data) ? data : [];
      set((state) => ({
        threads: page.reduce((acc, t) => upsertThread(acc, t), state.threads),
        hasMoreThreads: page.length >= LIST_LIMIT,
      }));
    } catch {
      if (get().roomId === roomId) set({ threadsError: true });
    } finally {
      if (get().roomId === roomId) set({ threadsLoading: false });
    }
  },

  openList: () => {
    set({
      view: "list",
      activeThreadId: null,
      draftRoot: null,
      replies: [],
      repliesError: false,
      hasMoreReplies: false,
      oldestReplyId: null,
      loadingOlderReplies: false,
      olderRepliesError: false,
      createError: null,
      resolveError: null,
    });
  },

  closePanel: () => {
    set({
      view: "closed",
      activeThreadId: null,
      draftRoot: null,
      replies: [],
      repliesError: false,
      hasMoreReplies: false,
      oldestReplyId: null,
      loadingOlderReplies: false,
      olderRepliesError: false,
      createError: null,
      resolveError: null,
    });
  },

  replyInThread: (message) => {
    const existing = get().threads.find((t) => t.rootMessageId === message.id);
    if (existing) {
      void get().openThread(existing.id);
      return;
    }
    set({
      view: "draft",
      draftRoot: message,
      activeThreadId: null,
      replies: [],
      hasMoreReplies: false,
      oldestReplyId: null,
      loadingOlderReplies: false,
      olderRepliesError: false,
      createError: null,
      resolveError: null,
    });
  },

  createThread: async (title) => {
    const { roomId, draftRoot, creating } = get();
    const trimmed = title.trim();
    if (!roomId || !draftRoot || creating || trimmed === "") return;
    set({ creating: true, createError: null });
    try {
      const res = await apiClient(`/api/rooms/${roomId}/threads`, {
        method: "POST",
        body: JSON.stringify({ title: trimmed, rootMessageId: draftRoot.id }),
      });
      if (get().roomId !== roomId) return;
      if (res.ok) {
        const thread: Thread = await res.json();
        set((state) => ({ threads: upsertThread(state.threads, thread) }));
        await get().openThread(thread.id);
        return;
      }
      // Another session started a thread on this message first: show that one.
      await get().loadThreads(roomId);
      const existing = get().threads.find((t) => t.rootMessageId === draftRoot.id);
      if (existing) {
        await get().openThread(existing.id);
        return;
      }
      set({ createError: "threads.createFailed" });
    } catch {
      if (get().roomId === roomId) set({ createError: "threads.createFailed" });
    } finally {
      if (get().roomId === roomId) set({ creating: false });
    }
  },

  openThread: async (threadId) => {
    set({
      view: "thread",
      activeThreadId: threadId,
      draftRoot: null,
      replies: [],
      repliesError: false,
      hasMoreReplies: false,
      oldestReplyId: null,
      loadingOlderReplies: false,
      olderRepliesError: false,
      createError: null,
      resolveError: null,
    });
    await get().loadReplies(threadId);
  },

  loadReplies: async (threadId) => {
    const { roomId } = get();
    if (!roomId) return;
    const isCurrent = () => get().roomId === roomId && get().activeThreadId === threadId;
    set({ repliesLoading: true, repliesError: false });
    try {
      const res = await apiClient(
        `/api/rooms/${roomId}/messages?threadId=${encodeURIComponent(threadId)}&limit=${REPLY_LIMIT}`,
      );
      if (!isCurrent()) return;
      if (!res.ok) {
        set({ repliesError: true });
        return;
      }
      const data = await res.json();
      const fetched: Message[] = Array.isArray(data) ? data : (data.messages ?? []);
      // A reply that arrived live while the request ran is kept.
      set((state) => ({
        replies: mergeReplies(state.replies, fetched),
        hasMoreReplies: fetched.length >= REPLY_LIMIT,
        oldestReplyId: fetched[0]?.id ?? state.oldestReplyId,
      }));
    } catch {
      if (isCurrent()) set({ repliesError: true });
    } finally {
      if (isCurrent()) set({ repliesLoading: false });
    }
  },

  loadOlderReplies: async () => {
    const { roomId, activeThreadId: threadId, oldestReplyId, loadingOlderReplies, hasMoreReplies } = get();
    if (!roomId || !threadId || !oldestReplyId || loadingOlderReplies || !hasMoreReplies) return;
    const isCurrent = () => get().roomId === roomId && get().activeThreadId === threadId;
    set({ loadingOlderReplies: true, olderRepliesError: false });
    try {
      // The server answers the page before `before`, newest first, reversed to
      // oldest first; merging dedupes by id in case a page overlaps.
      const res = await apiClient(
        `/api/rooms/${roomId}/messages?threadId=${encodeURIComponent(threadId)}&limit=${REPLY_LIMIT}&before=${encodeURIComponent(oldestReplyId)}`,
      );
      if (!isCurrent()) return;
      if (!res.ok) {
        set({ olderRepliesError: true });
        return;
      }
      const data = await res.json();
      const fetched: Message[] = Array.isArray(data) ? data : (data.messages ?? []);
      set((state) => ({
        replies: mergeReplies(state.replies, fetched),
        hasMoreReplies: fetched.length >= REPLY_LIMIT,
        oldestReplyId: fetched[0]?.id ?? state.oldestReplyId,
      }));
    } catch {
      if (isCurrent()) set({ olderRepliesError: true });
    } finally {
      if (isCurrent()) set({ loadingOlderReplies: false });
    }
  },

  setResolved: async (threadId, isResolved) => {
    const { roomId, resolving } = get();
    if (!roomId || resolving) return;
    set({ resolving: true, resolveError: null });
    try {
      const res = await apiClient(`/api/rooms/${roomId}/threads/${threadId}`, {
        method: "PATCH",
        body: JSON.stringify({ isResolved }),
      });
      if (get().roomId !== roomId) return;
      if (!res.ok) {
        // The server refused: the thread keeps its state, the panel says why.
        set({
          resolveError:
            res.status === 403 ? "threads.resolveForbidden" : "threads.resolveFailed",
        });
        return;
      }
      const updated: Thread = await res.json();
      set((state) => ({ threads: upsertThread(state.threads, updated) }));
    } catch {
      if (get().roomId === roomId) set({ resolveError: "threads.resolveFailed" });
    } finally {
      if (get().roomId === roomId) set({ resolving: false });
    }
  },

  applyThreadCreated: (thread) => {
    if (thread.roomId !== get().roomId) return;
    set((state) => ({ threads: upsertThread(state.threads, thread) }));
  },

  applyReply: (message) => {
    const threadId = message.threadId;
    if (!threadId || message.roomId !== get().roomId) return;
    set((state) => {
      const isOpen = state.activeThreadId === threadId;
      const inOpen = isOpen && state.replies.some((r) => r.id === message.id);
      const counted = !!state.countedReplyIds[message.id];
      const replies =
        isOpen && !inOpen ? sortReplies([...state.replies, message]) : state.replies;
      // A reply counts once, open thread or closed: a second delivery of the
      // same message (or one the loaded replies already hold) only fills the panel.
      if (inOpen || counted) return replies === state.replies ? state : { replies };
      const threads = state.threads.map((t) =>
        t.id === threadId
          ? { ...t, messageCount: t.messageCount + 1, lastActivity: message.createdAt }
          : t,
      );
      return {
        threads: sortThreads(threads),
        replies,
        countedReplyIds: { ...state.countedReplyIds, [message.id]: true },
      };
    });
  },

  removeReply: (messageId) => {
    set((state) =>
      state.replies.some((r) => r.id === messageId)
        ? { replies: state.replies.filter((r) => r.id !== messageId) }
        : state,
    );
  },
}));
