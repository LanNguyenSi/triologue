import { create } from "zustand";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "./authStore";

export type NotificationType = "info" | "success" | "warning" | "error";

type NotificationSource = "local" | "server";
type NotificationScope = "all" | "local" | "server";

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  type: NotificationType;
  createdAt: number;
  read: boolean;
  link?: string;
  source: NotificationSource;
  eventType?: string;
}

interface InboxApiItem {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationState {
  items: AppNotification[];
  add: (notification: Omit<AppNotification, "id" | "createdAt" | "read" | "source">) => string;
  loadInbox: () => Promise<void>;
  upsertServerItem: (item: InboxApiItem) => void;
  markRead: (id: string) => void;
  markAllRead: (scope?: NotificationScope) => void;
  remove: (id: string) => void;
  clear: (scope?: NotificationScope) => void;
  reset: () => void;
}

const MAX_ITEMS = 100;

function severityFromEventType(eventType: string): NotificationType {
  if (!eventType) return "info";
  if (eventType.includes("deleted") || eventType.includes("blocked")) return "warning";
  if (eventType.includes("failed") || eventType.includes("error")) return "error";
  if (eventType.includes("assigned") || eventType.includes("invited") || eventType.includes("added")) return "success";
  return "info";
}

function toNotification(item: InboxApiItem): AppNotification {
  return {
    id: item.id,
    title: item.title || "Update",
    message: item.message || undefined,
    type: severityFromEventType(item.type),
    createdAt: new Date(item.createdAt).getTime(),
    read: Boolean(item.isRead),
    link: item.link || undefined,
    source: "server",
    eventType: item.type,
  };
}

function mergeAndSort(items: AppNotification[]): AppNotification[] {
  const byId = new Map<string, AppNotification>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS);
}

function inScope(item: AppNotification, scope: NotificationScope): boolean {
  if (scope === "all") return true;
  return item.source === scope;
}

async function safeFetch(path: string, init: RequestInit): Promise<void> {
  try {
    await apiClient(path, init);
  } catch {
    // Ignore network errors for optimistic UI interactions.
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],

  add: (notification) => {
    const id = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const next: AppNotification = {
      id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      link: notification.link,
      createdAt: Date.now(),
      read: false,
      source: "local",
    };

    set((state) => ({ items: mergeAndSort([next, ...state.items]) }));
    return id;
  },

  loadInbox: async () => {
    const token = useAuthStore.getState().token;
    if (!token) {
      set({ items: [] });
      return;
    }

    try {
      const res = await apiClient(`/api/inbox?limit=${MAX_ITEMS}`, {
        method: "GET",
      });

      if (!res.ok) return;

      const data = await res.json();
      const serverItems = Array.isArray(data?.items)
        ? data.items.map((item: InboxApiItem) => toNotification(item))
        : [];

      const localItems = get().items.filter((item) => item.source === "local");
      set({ items: mergeAndSort([...serverItems, ...localItems]) });
    } catch {
      // Keep existing items.
    }
  },

  upsertServerItem: (item) => {
    const next = toNotification(item);
    set((state) => ({
      items: mergeAndSort([next, ...state.items.filter((existing) => existing.id !== next.id)]),
    }));
  },

  markRead: (id) => {
    const item = get().items.find((entry) => entry.id === id);
    set((state) => ({
      items: state.items.map((entry) => (entry.id === id ? { ...entry, read: true } : entry)),
    }));

    if (!item || item.source !== "server") return;

    const token = useAuthStore.getState().token;
    if (!token) return;

    void safeFetch(`/api/inbox/${encodeURIComponent(id)}/read`, {
      method: "PATCH",
    });
  },

  markAllRead: (scope = "all") => {
    const hasUnreadServerItems = get().items.some(
      (item) => inScope(item, scope) && item.source === "server" && !item.read,
    );
    set((state) => ({
      items: state.items.map((entry) => (inScope(entry, scope) ? { ...entry, read: true } : entry)),
    }));

    if (!hasUnreadServerItems) return;

    const token = useAuthStore.getState().token;
    if (!token) return;

    void safeFetch(`/api/inbox/read-all`, {
      method: "PATCH",
    });
  },

  remove: (id) => {
    const item = get().items.find((entry) => entry.id === id);

    set((state) => ({
      items: state.items.filter((entry) => entry.id !== id),
    }));

    if (!item || item.source !== "server") return;

    const token = useAuthStore.getState().token;
    if (!token) return;

    void safeFetch(`/api/inbox/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  clear: (scope = "all") => {
    const hasServerItems = get().items.some(
      (item) => inScope(item, scope) && item.source === "server",
    );
    set((state) => ({
      items: state.items.filter((item) => !inScope(item, scope)),
    }));

    if (!hasServerItems) return;

    const token = useAuthStore.getState().token;
    if (!token) return;

    void safeFetch(`/api/inbox`, {
      method: "DELETE",
    });
  },

  reset: () => set({ items: [] }),
}));
