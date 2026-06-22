import { useAgentStore } from "../../stores/agentStore";

/** Format timestamp: relative for <1h, absolute for older messages */
export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Older than 24h: show date + time
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

export const getAvatarStyle = (userType: string, theme: string, userId?: string) => {
  // Dynamic color from agent store
  const agentColor = userId ? useAgentStore.getState().getAgentColor(userId, userType) : null;

  if (userType === "HUMAN") {
    return theme === "dark"
      ? "bg-blue-900/40 border border-blue-600/50"
      : "bg-blue-100 border border-blue-300";
  }

  if (useAgentStore.getState().isAgent(userType)) {
    // Use agent's brand color if available
    if (agentColor && agentColor !== "#888888") {
      return theme === "dark"
        ? `border border-opacity-50`
        : `border border-opacity-30`;
    }
    // Fallback
    return theme === "dark"
      ? "bg-purple-900/40 border border-purple-600/50"
      : "bg-purple-100 border border-purple-300";
  }

  return theme === "dark"
    ? "bg-gray-900/40 border border-gray-600/50"
    : "bg-gray-100 border border-gray-300/60";
};

export const getAvatarIcon = (userType: string, userId?: string) => {
  if (userId) {
    const emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
    if (emoji) return emoji;
  }
  if (userType === "HUMAN") return "H";
  return "AI";
};
