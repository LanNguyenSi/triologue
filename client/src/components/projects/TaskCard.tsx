import React from "react";
import { PaperClipIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "../../contexts/LanguageContext";
import { Badge, Button, Card } from "../ui/primitives";
import { taskPriorityBadgeVariant } from "../../utils/statusBadges";
import type { Task, TeamMember, TaskReviewer } from "../../projects/projectDomainTypes";

export interface TaskCardProps {
  task: Task;
  assignedMember: TeamMember | undefined;
  reviewerMember: TaskReviewer | TeamMember | null | undefined;
  canDrag: boolean;
  canEditTask: boolean;
  isDark: boolean;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onEdit: () => void;
  onAttachments: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  assignedMember,
  reviewerMember,
  canDrag,
  canEditTask,
  isDark,
  onDragStart,
  onEdit,
  onAttachments,
}) => {
  const { t } = useLanguage();

  return (
    <Card
      className={`p-3 overflow-hidden ${
        canDrag
          ? isDark
            ? "cursor-move hover:bg-gray-700"
            : "cursor-move hover:shadow-sm"
          : "cursor-not-allowed opacity-90"
      } transition-[color,opacity]`}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("taskId", task.id);
        onDragStart(e);
      }}
    >
      <div className="font-medium text-sm leading-5 break-words [overflow-wrap:anywhere]">
        {task.title}
      </div>
      {task.description && (
        <div
          className={`text-xs mt-1.5 break-words [overflow-wrap:anywhere] overflow-hidden line-clamp-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {task.description}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div
          className={`text-xs ${isDark ? "text-gray-300" : "text-gray-600"}`}
        >
          <PaperClipIcon className="w-3 h-3 inline -mt-0.5" />{" "}
          {task.attachments?.length || 0} {t("projects.task.attachments")}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 whitespace-nowrap"
          onClick={onAttachments}
        >
          {t("projects.task.attachment.manage")}
        </Button>
      </div>

      <div
        className={`text-xs mt-2 break-words [overflow-wrap:anywhere] ${isDark ? "text-gray-300" : "text-gray-600"}`}
      >
        {t("projects.task.assignee")}:{" "}
        {assignedMember
          ? `${assignedMember.displayName} (@${assignedMember.username})`
          : task.assignedTo}
      </div>
      <div
        className={`text-xs mt-1 break-words [overflow-wrap:anywhere] ${isDark ? "text-gray-300" : "text-gray-600"}`}
      >
        Reviewer:{" "}
        {reviewerMember
          ? `${reviewerMember.displayName} (@${reviewerMember.username})`
          : task.reviewedBy || "Unassigned"}
      </div>

      {Array.isArray(task.usedMemoryIds) && task.usedMemoryIds.length > 0 && (
        <div className="mt-2">
          <div
            className={`text-[11px] mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Memory
          </div>
          <div className="flex flex-wrap gap-1">
            {task.usedMemoryIds.slice(0, 4).map((memoryId) => (
              <Badge key={`${task.id}:${memoryId}`} variant="neutral">
                <span
                  className="truncate max-w-[120px] inline-block align-bottom"
                  title={memoryId}
                >
                  {memoryId.length > 12
                    ? `${memoryId.slice(0, 6)}…${memoryId.slice(-4)}`
                    : memoryId}
                </span>
              </Badge>
            ))}
            {task.usedMemoryIds.length > 4 && (
              <Badge variant="neutral">+{task.usedMemoryIds.length - 4}</Badge>
            )}
          </div>
        </div>
      )}

      {!canDrag && (
        <div
          className={`text-[11px] mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {t("projects.task.drag.onlyAssignee")}
        </div>
      )}

      {task.priority && (
        <Badge
          variant={taskPriorityBadgeVariant(task.priority)}
          className="mt-2"
        >
          {t(`projects.priority.${task.priority}`)}
        </Badge>
      )}

      {canEditTask && (
        <div className="mt-2">
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            {t("projects.task.edit")}
          </Button>
        </div>
      )}
    </Card>
  );
};
