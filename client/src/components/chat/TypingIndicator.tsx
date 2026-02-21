import React from "react";
import { useTheme } from "../../contexts/ThemeContext";

interface TypingUser {
  username: string;
  userType: string;
}

interface TypingIndicatorProps {
  users: TypingUser[];
}

const getIcon = (userType: string, userId?: string) => {
  if (userId) {
    try {
      const { useAgentStore } = require("../../stores/agentStore");
      const emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
      if (emoji) return emoji;
    } catch { /* store not loaded yet */ }
  }
  if (userType === "HUMAN") return "👨‍💻";
  return "🤖";
};

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ users }) => {
  if (users.length === 0) return null;
  const { theme } = useTheme();

  const names = users
    .map((u) => `${getIcon(u.userType)} ${u.username}`)
    .join(", ");
  const verb = users.length === 1 ? "is typing" : "are typing";

  return (
    <div
      className={`flex items-center gap-2 text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
    >
      <div className="flex gap-1 items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
      </div>
      <span>
        {names} {verb}
      </span>
    </div>
  );
};
