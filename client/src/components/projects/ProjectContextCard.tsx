import React from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Button, Card, SectionHeader } from "../ui/primitives";
import type { ProjectContext } from "../../projects/projectTypes";

export interface ProjectContextCardProps {
  projectContext: ProjectContext;
  isOwner: boolean;
  projectId: string;
}

export const ProjectContextCard: React.FC<ProjectContextCardProps> = ({
  projectContext,
  isOwner,
  projectId,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isDark = theme === "dark";

  const cellCls = `rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`;
  const labelCls = `mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`;
  const entryRowCls = `rounded border px-2 py-2 text-xs ${isDark ? "border-gray-700/50 bg-gray-800" : "border-gray-200/60 bg-gray-50"}`;

  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader
        title={t("projects.context.title")}
        className="mb-3"
        actions={
          isOwner ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => navigate(`/projects/${projectId}/edit`)}
            >
              {t("projects.actions.edit")}
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-3">
        <div className={cellCls}>
          <div className={labelCls}>{t("projects.context.dod.title")}</div>
          {projectContext.definitionOfDone.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {projectContext.definitionOfDone.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className={isDark ? "text-gray-100" : "text-gray-800"}
                >
                  - {item}
                </li>
              ))}
            </ul>
          ) : (
            <div
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("projects.context.empty")}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className={cellCls}>
            <div className={labelCls}>
              {t("projects.context.decision.title")}
            </div>
            {projectContext.decisionLog.length > 0 ? (
              <div className="space-y-2">
                {projectContext.decisionLog.map((entry) => (
                  <div key={entry.id} className={entryRowCls}>
                    <div
                      className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                    >
                      {entry.date || t("projects.context.empty")} -{" "}
                      {entry.title || t("projects.context.empty")}
                    </div>
                    <div className={isDark ? "text-gray-300" : "text-gray-700"}>
                      {entry.decision || t("projects.context.empty")}
                    </div>
                    <div className={isDark ? "text-gray-400" : "text-gray-600"}>
                      {entry.rationale || t("projects.context.empty")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("projects.context.empty")}
              </div>
            )}
          </div>

          <div className={cellCls}>
            <div className={labelCls}>
              {t("projects.context.milestones.title")}
            </div>
            {projectContext.milestones.length > 0 ? (
              <div className="space-y-2">
                {projectContext.milestones.map((entry) => (
                  <div key={entry.id} className={entryRowCls}>
                    <div
                      className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                    >
                      {entry.title || t("projects.context.empty")}
                    </div>
                    <div className={isDark ? "text-gray-300" : "text-gray-700"}>
                      {entry.dueDate || t("projects.context.empty")} -{" "}
                      {t(
                        `projects.context.milestones.status.${entry.status}`,
                      )}
                    </div>
                    <div className={isDark ? "text-gray-400" : "text-gray-600"}>
                      {entry.notes || t("projects.context.empty")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("projects.context.empty")}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className={cellCls}>
            <div className={labelCls}>{t("projects.context.brief.title")}</div>
            <div className="space-y-2 text-sm">
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.brief.goal")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.brief.goal || t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.brief.scope")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.brief.scope || t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.brief.outOfScope")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.brief.outOfScope ||
                    t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.brief.successCriteria")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.brief.successCriteria ||
                    t("projects.context.empty")}
                </div>
              </div>
            </div>
          </div>

          <div className={cellCls}>
            <div className={labelCls}>
              {t("projects.context.runbook.title")}
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.runbook.preferredLanguage")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.runbook.preferredLanguage ||
                    t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.runbook.responseStyle")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.runbook.responseStyle ||
                    t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.runbook.constraints")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.runbook.constraints ||
                    t("projects.context.empty")}
                </div>
              </div>
              <div>
                <div
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.runbook.escalationPath")}
                </div>
                <div className={isDark ? "text-gray-100" : "text-gray-800"}>
                  {projectContext.runbook.escalationPath ||
                    t("projects.context.empty")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
