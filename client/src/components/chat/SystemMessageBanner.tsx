import React from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { ApprovalRequestPayload } from "../../types/chat";

export const SystemMessageBanner: React.FC<{ content: string }> = ({ content }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(content) as Record<string, unknown>; } catch { /* not JSON */ }

  if (parsed?.type === 'approval_request') {
    const p = parsed as unknown as ApprovalRequestPayload;
    return (
      <div className={`my-2 mx-3 px-3 py-2 rounded-lg border flex items-center gap-2 text-sm ${
        isDark
          ? 'bg-amber-900/20 border-amber-700/40 text-amber-200'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <span>🔔</span>
        <span className="flex-1">
          Agent wartet auf Freigabe —{' '}
          <span className="font-mono text-xs">{p.connectorId}/{p.actionId}</span>
          {p.riskLevel && <span className={`ml-1 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>({p.riskLevel} risk)</span>}
        </span>
        <a
          href="/approvals"
          className={`text-xs font-medium underline underline-offset-2 shrink-0 ${
            isDark ? 'text-amber-300 hover:text-amber-100' : 'text-amber-700 hover:text-amber-900'
          }`}
        >
          → Approvals öffnen
        </a>
      </div>
    );
  }

  // Fallback for other SYSTEM messages
  return (
    <div className={`my-2 mx-3 px-3 py-2 rounded-lg border text-xs ${
      isDark
        ? 'bg-gray-800/50 border-gray-700/40 text-gray-400'
        : 'bg-gray-50 border-gray-200 text-gray-500'
    }`}>
      🔔 {content}
    </div>
  );
};
