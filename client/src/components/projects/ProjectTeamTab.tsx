import React, { useState } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { apiClient } from "../../lib/apiClient";
import { InvitePopup } from "../chat/InvitePopup";
import { Badge, Button, Card, EmptyState, Input, SectionHeader } from "../ui/primitives";
import type { Project, TeamMember } from "../../projects/projectDomainTypes";

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export interface ProjectTeamTabProps {
  project: Project;
  teamMemberLookup: Map<string, TeamMember>;
  isOwner: boolean;
  loadProject: () => Promise<void>;
}

export const ProjectTeamTab: React.FC<ProjectTeamTabProps> = ({
  project,
  teamMemberLookup,
  isOwner,
  loadProject,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviting, setInviting] = useState(false);

  const getUserTypeLabel = (
    userType?: TeamMember["userType"] | string | null,
  ) => {
    if (!userType) return "";
    switch (userType) {
      case "HUMAN":
        return t("projects.userType.human");
      case "AI_AGENT":
        return t("projects.userType.ai_agent");
      case "AI_ICE":
        return t("projects.userType.ai_ice");
      case "AI_LAVA":
        return t("projects.userType.ai_lava");
      case "AI_OTHER":
        return t("projects.userType.ai_other");
      default:
        return userType;
    }
  };

  const handleInvite = async (payload: { username: string }) => {
    setInviteStatus("");
    setInviting(true);
    try {
      const res = await api(`/api/projects/${project.id}/team/invite`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteStatus(data.error || t("projects.team.invite.failed"));
        return;
      }

      setInviteStatus(t("projects.team.invite.success"));
      setInviteUsername("");
      await loadProject();
    } catch (err) {
      console.error(err);
      setInviteStatus(t("projects.team.invite.networkError"));
    } finally {
      setInviting(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      <SectionHeader
        title={t("projects.tab.team")}
        actions={
          <Badge variant="neutral">{project.teamMemberIds.length}</Badge>
        }
      />

      {isOwner && (
        <Card tone="muted" className="p-3 sm:p-4">
          <SectionHeader
            title={t("projects.team.invite.title")}
            className="mb-3"
          />
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!inviteUsername.trim()) return;
                void handleInvite({ username: inviteUsername.trim() });
              }}
              className="space-y-2"
            >
              <label
                className={`block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("projects.team.invite.usernameLabel")}{" "}
                <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Input
                  value={inviteUsername}
                  onChange={(e) => {
                    setInviteUsername(e.target.value);
                    setInviteStatus("");
                  }}
                  placeholder={t("projects.team.invite.usernamePlaceholder")}
                  required
                />
                {project.roomId && (
                  <InvitePopup
                    roomId={project.roomId}
                    query={inviteUsername}
                    visible={inviteUsername.trim().length > 0}
                    onSelect={(username) => {
                      setInviteUsername(username);
                      setInviteStatus("");
                    }}
                  />
                )}
              </div>
              <div
                className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("projects.team.invite.usernameHint")}
              </div>

              <Button
                type="submit"
                disabled={inviting}
                size="sm"
                className="w-full sm:w-auto"
              >
                {t("projects.team.invite.submit")}
              </Button>
            </form>
          </div>

          {inviteStatus && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                isDark
                  ? "border-blue-800/50 bg-blue-900/20 text-blue-300"
                  : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {inviteStatus}
            </div>
          )}
        </Card>
      )}

      {project.teamMemberIds.length === 0 ? (
        <EmptyState
          title={t("projects.team.empty")}
          icon={<UserGroupIcon className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-3">
          {project.teamMemberIds.map((memberId) => {
            const member = teamMemberLookup.get(memberId);
            return (
              <Card
                key={memberId}
                tone="muted"
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {member
                      ? `${member.displayName} (@${member.username})`
                      : memberId}
                  </div>
                  <div
                    className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {member?.email ||
                      getUserTypeLabel(member?.userType) ||
                      memberId}
                  </div>
                </div>
                {memberId === project.ownerId && (
                  <Badge variant="info">{t("projects.team.owner")}</Badge>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
};
