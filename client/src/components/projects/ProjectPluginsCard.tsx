import React from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Badge, Button, Card, SectionHeader } from "../ui/primitives";
import type { ProjectPluginEntry } from "../../projects/projectDomainTypes";

export interface ProjectPluginsCardProps {
  projectId: string;
  projectPlugins: ProjectPluginEntry[];
  loadingProjectPlugins: boolean;
  updatingProjectPluginId: string | null;
  onToggleLink: (pluginId: string, linked: boolean) => void;
}

export const ProjectPluginsCard: React.FC<ProjectPluginsCardProps> = ({
  projectId,
  projectPlugins,
  loadingProjectPlugins,
  updatingProjectPluginId,
  onToggleLink,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader
        title={t("projects.plugins.title")}
        actions={<Badge variant="neutral">{projectPlugins.length}</Badge>}
        className="mb-3"
      />
      {loadingProjectPlugins ? (
        <div
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          {t("common.loading")}
        </div>
      ) : projectPlugins.length === 0 ? (
        <div
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          {t("projects.plugins.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {projectPlugins.map((plugin) => {
            const canOpen = plugin.linked && plugin.enabled;
            const isToggling = updatingProjectPluginId === plugin.id;
            return (
              <div
                key={plugin.id}
                className={`rounded border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-gray-50"}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-sm font-medium ${isDark ? "text-gray-100" : "text-gray-800"}`}
                  >
                    {plugin.name}
                  </span>
                  <Badge variant={plugin.linked ? "success" : "neutral"}>
                    {plugin.linked
                      ? t("projects.plugins.linked")
                      : t("projects.plugins.unlinked")}
                  </Badge>
                  {!plugin.workspaceEnabled && (
                    <Badge variant="warning">
                      {t("projects.plugins.globallyDisabled")}
                    </Badge>
                  )}
                  {plugin.workspaceEnabled && !plugin.userEnabled && (
                    <Badge variant="warning">
                      {t("projects.plugins.disabledForYou")}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {canOpen && (
                    <Link
                      to={`/plugins/${plugin.id}?projectId=${projectId}`}
                      className={`inline-flex text-xs font-medium ${
                        isDark
                          ? "text-emerald-300 hover:text-emerald-200"
                          : "text-emerald-700 hover:text-emerald-600"
                      }`}
                    >
                      {t("projects.plugins.openModule")}
                    </Link>
                  )}
                  {plugin.canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant={plugin.linked ? "secondary" : "primary"}
                      disabled={isToggling}
                      onClick={() => onToggleLink(plugin.id, !plugin.linked)}
                      className="h-7 px-2.5 text-xs"
                    >
                      {isToggling
                        ? t("common.loading")
                        : plugin.linked
                          ? t("projects.plugins.disconnect")
                          : t("projects.plugins.connect")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
