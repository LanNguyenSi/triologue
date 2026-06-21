import React from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import { Badge, Card } from "../ui/primitives";
import { TaskCard } from "./TaskCard";
import type { Task, TeamMember } from "../../projects/projectDomainTypes";
import type { WorkflowConfig } from "../../projects/projectTypes";

export interface ProjectKanbanBoardProps {
  statuses: string[];
  workflowConfig: WorkflowConfig;
  tasks: Task[];
  teamMemberLookup: Map<string, TeamMember>;
  user: { id: string } | null;
  isOwner: boolean;
  isDark: boolean;
  onStatusChange: (taskId: string, status: string) => void;
  onEditTask: (task: Task) => void;
  onTaskAttachments: (taskId: string) => void;
}

export const ProjectKanbanBoard: React.FC<ProjectKanbanBoardProps> = ({
  statuses,
  workflowConfig,
  tasks,
  teamMemberLookup,
  user,
  isOwner,
  isDark,
  onStatusChange,
  onEditTask,
  onTaskAttachments,
}) => {
  const { t } = useLanguage();

  const getTasksByStatus = (status: string) =>
    tasks.filter((task) => task.status === status);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
      {statuses.map((status) => {
        const statusTasks = getTasksByStatus(status);
        return (
          <Card
            key={status}
            tone="muted"
            className="p-4 min-h-[240px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData("taskId");
              if (taskId) onStatusChange(taskId, status);
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-xs uppercase tracking-wide">
                {t(`projects.status.${status}`) || status.replace("_", " ")}
              </h3>
              <Badge variant="neutral">{statusTasks.length}</Badge>
            </div>
            {workflowConfig.instructions[status]?.trim() && (
              <div
                className={`mb-3 rounded border px-2 py-1 text-[11px] leading-4 break-words [overflow-wrap:anywhere] ${isDark ? "border-gray-700/50 text-gray-400" : "border-gray-200/60 text-gray-600"}`}
              >
                {workflowConfig.instructions[status]}
              </div>
            )}
            {statusTasks.length === 0 ? (
              <div
                className={`rounded-lg border border-dashed px-3 py-5 text-center text-xs ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-400"}`}
              >
                {t("projects.task.emptyColumn")}
              </div>
            ) : (
              <div className="space-y-3">
                {statusTasks.map((task) => {
                  const assignedMember = teamMemberLookup.get(task.assignedTo);
                  const reviewerMember =
                    task.reviewer ||
                    (task.reviewedBy
                      ? teamMemberLookup.get(task.reviewedBy)
                      : null);
                  const canDrag = user?.id === task.assignedTo;
                  const canEditTask = Boolean(
                    isOwner || user?.id === task.assignedTo,
                  );

                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      assignedMember={assignedMember}
                      reviewerMember={reviewerMember}
                      canDrag={canDrag}
                      canEditTask={canEditTask}
                      isDark={isDark}
                      onDragStart={() => {
                        // DnD data already set inside TaskCard; no additional work needed here.
                      }}
                      onEdit={() => onEditTask(task)}
                      onAttachments={() => onTaskAttachments(task.id)}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};
