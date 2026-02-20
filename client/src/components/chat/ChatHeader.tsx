import React from "react";
import { Bars3Icon, UsersIcon } from "@heroicons/react/24/outline";
import { useTheme } from "../../contexts/ThemeContext";

interface Room {
  id: string;
  name: string;
  description?: string;
}

interface ChatHeaderProps {
  room: Room | null;
  onToggleSidebar: () => void;
  onToggleUserList: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  room,
  onToggleSidebar,
  onToggleUserList,
}) => {
  const { theme } = useTheme();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className={`p-2 rounded-lg transition-colors ${
            theme === "dark"
              ? "hover:bg-gray-700 text-gray-300 hover:text-white"
              : "hover:bg-gray-100 text-gray-600 hover:text-gray-900"
          }`}
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
        <div>
          <h1
            className={`text-lg font-semibold ${
              theme === "dark" ? "text-white" : "text-gray-900"
            }`}
          >
            🧊🌋👨‍💻 {room?.name || "Triologue"}
          </h1>
          {room?.description && (
            <p
              className={`text-sm ${
                theme === "dark" ? "text-gray-400" : "text-gray-600"
              }`}
            >
              {room.description}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onToggleUserList}
        className={`p-2 rounded-lg transition-colors ${
          theme === "dark"
            ? "hover:bg-gray-700 text-gray-300 hover:text-white"
            : "hover:bg-gray-100 text-gray-600 hover:text-gray-900"
        }`}
      >
        <UsersIcon className="w-5 h-5" />
      </button>
    </div>
  );
};
