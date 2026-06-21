import React from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Badge, Card } from "../ui/primitives";
import { projectStatusBadgeVariant } from "../../utils/statusBadges";
import type { Project } from "../../projects/projectDomainTypes";

export interface ProjectOverviewCardProps {
  project: Project;
}

export const ProjectOverviewCard: React.FC<ProjectOverviewCardProps> = ({
  project,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const cellCls = `rounded-lg border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`;
  const metaLabelCls = `text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`;

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide">
        {t("projects.detail.status")}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className={cellCls}>
          <div className={metaLabelCls}>{t("projects.detail.status")}</div>
          <div className="mt-1">
            <Badge variant={projectStatusBadgeVariant(project.status)}>
              {t(`projects.status.${project.status}`) || project.status}
            </Badge>
          </div>
        </div>
        <div className={cellCls}>
          <div className={metaLabelCls}>{t("projects.detail.created")}</div>
          <div
            className={`mt-1 text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}
          >
            {new Date(project.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className={cellCls}>
          <div className={metaLabelCls}>{t("projects.room.linked")}</div>
          {project.roomId ? (
            <div className="mt-1 space-y-1">
              <div
                className="break-all font-mono text-xs sm:text-sm text-blue-400"
                title={project.roomId}
              >
                {project.roomId}
              </div>
              <Link
                to={`/room/${project.roomId}`}
                className={`inline-flex text-xs font-medium ${isDark ? "text-blue-300 hover:text-blue-200" : "text-blue-700 hover:text-blue-600"}`}
                aria-label={t("projects.a11y.openRoom").replace(
                  "{name}",
                  project.roomId,
                )}
              >
                {t("projects.actions.room")}
              </Link>
            </div>
          ) : (
            <div
              className={`mt-1 text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
            >
              {t("projects.room.none")}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
