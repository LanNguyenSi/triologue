import { create } from "zustand";
import { PluginManifest } from "../types/plugins";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "./authStore";

interface PluginState {
  plugins: PluginManifest[];
  isLoading: boolean;
  loadPlugins: () => Promise<void>;
  resetPlugins: () => void;
}

let loadPluginsInFlight: Promise<void> | null = null;

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  isLoading: false,

  loadPlugins: async () => {
    if (loadPluginsInFlight) return loadPluginsInFlight;

    loadPluginsInFlight = (async () => {
      set({ isLoading: true });
      try {
        const token = useAuthStore.getState().token;
        if (!token) {
          set({ plugins: [] });
          return;
        }

        const response = await apiClient("/api/plugins");
        if (!response.ok) {
          throw new Error(`Failed to load plugins (${response.status})`);
        }

        const data = await response.json();
        const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
        set({ plugins });
      } catch (error) {
        console.error("Failed to load plugins:", error);
        set({ plugins: [] });
      } finally {
        set({ isLoading: false });
      }
    })().finally(() => {
      loadPluginsInFlight = null;
    });

    return loadPluginsInFlight;
  },

  resetPlugins: () => set({ plugins: [], isLoading: false }),
}));

