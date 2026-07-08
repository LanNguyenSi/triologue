import type { CSSProperties } from "react";
import { useAgentStore } from "../../stores/agentStore";

/** Format timestamp: relative for <1h, absolute for older messages */
export function formatTime(dateStr: string, t: (key: string) => string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return t("projectActivity.time.justNow");
  if (diffMin < 60)
    return t("projectActivity.time.minutesAgo").replace("{count}", String(diffMin));
  if (diffHour < 24)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Older than 24h: show date + time
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

export interface AvatarStyle {
  className: string;
  style?: CSSProperties;
}

/** Parse #rgb / #rrggbb into an rgba() string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const getAvatarStyle = (userType: string, theme: string, userId?: string): AvatarStyle => {
  const isDark = theme === "dark";
  // Dynamic color from agent store
  const agentColor = userId ? useAgentStore.getState().getAgentColor(userId, userType) : null;

  if (userType === "HUMAN") {
    return {
      className: isDark
        ? "bg-blue-900/40 border border-blue-600/50"
        : "bg-blue-100 border border-blue-300",
    };
  }

  if (useAgentStore.getState().isAgent(userType)) {
    // Use agent's brand color if available. A dynamic hex cannot live in a
    // Tailwind class, so render it as an inline border + low-opacity fill so the
    // avatar is actually visible (the previous border-opacity-only classes had
    // no color and rendered transparent).
    const hasCustomColor =
      !!agentColor &&
      agentColor !== "#888888" &&
      /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(agentColor);
    if (hasCustomColor) {
      return {
        className: "border",
        style: {
          backgroundColor: hexToRgba(agentColor, isDark ? 0.25 : 0.15),
          borderColor: hexToRgba(agentColor, isDark ? 0.5 : 0.4),
        },
      };
    }
    // Fallback (no custom color)
    return {
      className: isDark
        ? "bg-purple-900/40 border border-purple-600/50"
        : "bg-purple-100 border border-purple-300",
    };
  }

  return {
    className: isDark
      ? "bg-gray-900/40 border border-gray-600/50"
      : "bg-gray-100 border border-gray-300/60",
  };
};

export const getAvatarIcon = (userType: string, userId?: string) => {
  const emoji = useAgentStore.getState().getAgentEmoji(userId ?? "", userType);
  if (emoji) return emoji;
  if (userType === "HUMAN") return "H";
  return "AI";
};
