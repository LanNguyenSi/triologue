import { create } from "zustand";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  type: NotificationType;
  createdAt: number;
  read: boolean;
  link?: string;
}

interface NotificationState {
  items: AppNotification[];
  add: (notification: Omit<AppNotification, "id" | "createdAt" | "read">) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_ITEMS = 60;

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],

  add: (notification) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const next: AppNotification = {
      id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      link: notification.link,
      createdAt: Date.now(),
      read: false,
    };

    set((state) => ({ items: [next, ...state.items].slice(0, MAX_ITEMS) }));
    return id;
  },

  markRead: (id) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    })),

  markAllRead: () =>
    set((state) => ({
      items: state.items.map((item) => ({ ...item, read: true })),
    })),

  remove: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clear: () => set({ items: [] }),
}));
