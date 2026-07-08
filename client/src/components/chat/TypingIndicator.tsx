import React from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { getAvatarIcon } from "./chatUtils";

interface TypingUser {
  username: string;
  userType: string;
}

interface TypingIndicatorProps {
  users: TypingUser[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ users }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();

  if (users.length === 0) return null;

  const names = users
    .map((u) => `${getAvatarIcon(u.userType)} ${u.username}`)
    .join(", ");
  const verb = users.length === 1 ? t("chat.typing.one") : t("chat.typing.many");

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
