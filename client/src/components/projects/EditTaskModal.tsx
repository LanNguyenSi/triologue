import React, { useState, useEffect, useId, useRef } from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Modal } from "../ui/Modal";
import { Badge, Button, Card, Input, SectionHeader, Select } from "../ui/primitives";
import { taskStatusBadgeVariant } from "../../utils/statusBadges";
import type { Task, TeamMember } from "../../projects/projectDomainTypes";
import type { EditTaskFields } from "../../hooks/useTaskManagement";

const PRIORITIES = ["low", "medium", "high"];

const normalizeUsedMemoryIds = (value: string): string[] =>
  Array.from(
    new Set(
      String(value || "")
        .split(/,|\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 40);

export interface EditTaskModalProps {
  open: boolean;
  task: Task | null;
  teamMemberIds: string[];
  teamMemberLookup: Map<string, TeamMember>;
  saving: boolean;
  /** When true (e.g. a delete confirm is stacked on top) Escape will not close this modal. */
  suppressEscape?: boolean;
  onClose: () => void;
  onSave: (taskId: string, fields: EditTaskFields) => void;
  onRequestDelete: (taskId: string) => void;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  open,
  task,
  teamMemberIds,
  teamMemberLookup,
  saving,
  suppressEscape = false,
  onClose,
  onSave,
  onRequestDelete,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const seededIdRef = useRef<string | null>(null);

  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("medium");
  const [editTaskAssignee, setEditTaskAssignee] = useState("");
  const [editTaskReviewer, setEditTaskReviewer] = useState("");
  const [editTaskMemoryIds, setEditTaskMemoryIds] = useState("");

  // Seed form state only when a different task is opened, not when the same
  // task's object identity changes (e.g. a background tasks refresh), which
  // would otherwise clobber the user's in-progress edits.
  useEffect(() => {
    if (!task) {
      seededIdRef.current = null;
      return;
    }
    if (seededIdRef.current === task.id) return;
    seededIdRef.current = task.id;
    setEditTaskTitle(task.title || "");
    setEditTaskDesc(task.description || "");
    setEditTaskPriority(task.priority || "medium");
    setEditTaskAssignee(task.assignedTo || "");
    setEditTaskReviewer(task.reviewedBy || "");
    setEditTaskMemoryIds(
      Array.isArray(task.usedMemoryIds) ? task.usedMemoryIds.join(", ") : "",
    );
  }, [task]);

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark
      ? "border-gray-600/50 bg-gray-700 text-white placeholder-gray-400"
      : "border-gray-300/60 bg-white"
  } outline-none focus:ring-2 focus:ring-blue-500`;

  const handleSave = () => {
    if (!task || !editTaskTitle.trim() || !editTaskAssignee) return;
    onSave(task.id, {
      title: editTaskTitle.trim(),
      description: editTaskDesc.trim(),
      priority: editTaskPriority,
      assignedTo: editTaskAssignee,
      reviewedBy: editTaskReviewer || null,
      usedMemoryIds: normalizeUsedMemoryIds(editTaskMemoryIds),
    });
  };

  if (!task) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledById={titleId}
      initialFocusRef={titleRef}
      closeOnEscape={!saving && !suppressEscape}
      closeOnBackdrop={!saving}
      className="w-full max-w-lg mx-4"
    >
      <Card
        className={`p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
      >
        <SectionHeader
          title={
            <span id={titleId}>{t("projects.task.edit")}</span>
          }
          className="mb-3"
          actions={
            <>
              <Badge variant={taskStatusBadgeVariant(task.status)}>
                {t(`projects.status.${task.status}`) || task.status}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                {t("projects.task.cancel")}
              </Button>
            </>
          }
        />
        <div className="space-y-3">
          <Input
            ref={titleRef}
            value={editTaskTitle}
            onChange={(e) => setEditTaskTitle(e.target.value)}
            placeholder={t("projects.task.title.placeholder")}
          />
          <textarea
            value={editTaskDesc}
            onChange={(e) => setEditTaskDesc(e.target.value)}
            rows={3}
            className={textAreaCls}
            placeholder={t("projects.task.description.placeholder")}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              value={editTaskPriority}
              onChange={(value) => setEditTaskPriority(value)}
              options={PRIORITIES.map((priority) => ({
                value: priority,
                label: t(`projects.priority.${priority}`),
              }))}
            />
            <Select
              value={editTaskAssignee}
              onChange={(value) => setEditTaskAssignee(value)}
              options={teamMemberIds.map((memberId) => {
                const member = teamMemberLookup.get(memberId);
                const label = member
                  ? `${member.displayName} (@${member.username})`
                  : memberId;
                return { value: memberId, label };
              })}
            />
            <Select
              value={editTaskReviewer}
              onChange={(value) => setEditTaskReviewer(value)}
              options={[
                { value: "", label: "No reviewer" },
                ...teamMemberIds.map((memberId) => {
                  const member = teamMemberLookup.get(memberId);
                  const label = member
                    ? `${member.displayName} (@${member.username})`
                    : memberId;
                  return { value: memberId, label };
                }),
              ]}
            />
          </div>
          <Input
            value={editTaskMemoryIds}
            onChange={(e) => setEditTaskMemoryIds(e.target.value)}
            placeholder="usedMemoryIds (comma separated)"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !editTaskTitle.trim() || !editTaskAssignee}
              className="w-full"
            >
              {saving ? t("projects.task.saving") : t("projects.task.save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
              className="w-full"
            >
              {t("projects.task.cancel")}
            </Button>
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            className="w-full"
            onClick={() => onRequestDelete(task.id)}
            disabled={saving}
          >
            {t("projects.task.delete")}
          </Button>
        </div>
      </Card>
    </Modal>
  );
};
