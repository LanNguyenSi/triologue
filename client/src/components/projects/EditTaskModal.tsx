import React, { useState, useEffect, useId, useRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { ChevronRightIcon, TrashIcon } from "@heroicons/react/24/outline";
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

// A labeled form row: a visible label tied to its control via htmlFor/id.
// Keeps every field consistently labeled without repeating the label markup.
const Field: React.FC<{
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}> = ({ htmlFor, label, children }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className={`mb-1.5 block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
      >
        {label}
      </label>
      {children}
    </div>
  );
};

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
  const fieldsId = useId();
  const fieldId = (name: string) => `${fieldsId}-${name}`;
  const titleRef = useRef<HTMLInputElement>(null);
  const seededIdRef = useRef<string | null>(null);

  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("medium");
  const [editTaskAssignee, setEditTaskAssignee] = useState("");
  const [editTaskReviewer, setEditTaskReviewer] = useState("");
  const [editTaskMemoryIds, setEditTaskMemoryIds] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    // Collapse the advanced section whenever a fresh task is opened.
    setShowAdvanced(false);
  }, [task]);

  // Textarea styled to match the Input primitive: same border/bg/text, focus
  // ring, and a theme-aware ring-offset so there is no bare white halo on dark.
  const textareaCls = `w-full resize-none rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed outline-none transition-colors duration-200 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 ${
    isDark ? "focus:ring-offset-gray-900" : "focus:ring-offset-white"
  } focus:border-blue-500 ${
    isDark
      ? "border-gray-600/80 bg-gray-800/60 text-white placeholder-gray-500"
      : "border-gray-200/60 bg-white text-gray-900 placeholder-gray-400 shadow-subtle"
  }`;

  const memberOptions = (members: string[]) =>
    members.map((memberId) => {
      const member = teamMemberLookup.get(memberId);
      const label = member
        ? `${member.displayName} (@${member.username})`
        : memberId;
      return { value: memberId, label };
    });

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
      className="w-full max-w-xl mx-4"
    >
      <Card
        className={`p-5 sm:p-6 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
      >
        <SectionHeader
          title={<span id={titleId}>{t("projects.task.edit")}</span>}
          className="mb-5"
          actions={
            <Badge variant={taskStatusBadgeVariant(task.status)}>
              {t(`projects.status.${task.status}`) || task.status}
            </Badge>
          }
        />

        <div className="space-y-4">
          <Field htmlFor={fieldId("title")} label={t("projects.task.field.title")}>
            <Input
              id={fieldId("title")}
              ref={titleRef}
              value={editTaskTitle}
              onChange={(e) => setEditTaskTitle(e.target.value)}
              placeholder={t("projects.task.title.placeholder")}
            />
          </Field>

          <Field
            htmlFor={fieldId("description")}
            label={t("projects.task.field.description")}
          >
            <TextareaAutosize
              id={fieldId("description")}
              value={editTaskDesc}
              onChange={(e) => setEditTaskDesc(e.target.value)}
              className={textareaCls}
              placeholder={t("projects.task.description.placeholder")}
              minRows={4}
              maxRows={16}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              htmlFor={fieldId("priority")}
              label={t("projects.task.field.priority")}
            >
              <Select
                id={fieldId("priority")}
                value={editTaskPriority}
                onChange={(value) => setEditTaskPriority(value)}
                options={PRIORITIES.map((priority) => ({
                  value: priority,
                  label: t(`projects.priority.${priority}`),
                }))}
              />
            </Field>
            <Field
              htmlFor={fieldId("assignee")}
              label={t("projects.task.field.assignee")}
            >
              <Select
                id={fieldId("assignee")}
                value={editTaskAssignee}
                onChange={(value) => setEditTaskAssignee(value)}
                options={memberOptions(teamMemberIds)}
              />
            </Field>
            <Field
              htmlFor={fieldId("reviewer")}
              label={t("projects.task.field.reviewer")}
            >
              <Select
                id={fieldId("reviewer")}
                value={editTaskReviewer}
                onChange={(value) => setEditTaskReviewer(value)}
                options={[
                  { value: "", label: t("projects.task.noReviewer") },
                  ...memberOptions(teamMemberIds),
                ]}
              />
            </Field>
          </div>

          {/* Advanced: optional agent memory references, collapsed by default. */}
          <div>
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 ${
                isDark
                  ? "focus-visible:ring-offset-gray-900 text-gray-400 hover:text-gray-200"
                  : "focus-visible:ring-offset-white text-gray-500 hover:text-gray-700"
              }`}
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-200 ${showAdvanced ? "rotate-90" : ""}`}
                aria-hidden="true"
              />
              {t("projects.task.advanced")}
            </button>
            {showAdvanced && (
              <div className="mt-3">
                <Field
                  htmlFor={fieldId("memoryIds")}
                  label={t("projects.task.field.memoryIds")}
                >
                  <Input
                    id={fieldId("memoryIds")}
                    value={editTaskMemoryIds}
                    onChange={(e) => setEditTaskMemoryIds(e.target.value)}
                    placeholder="mem-1, mem-2"
                  />
                </Field>
                <p
                  className={`mt-1.5 text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}
                >
                  {t("projects.task.memoryIds.helper")}
                </p>
              </div>
            )}
          </div>

          {/* Footer: Save is the primary action, Cancel the single secondary. */}
          <div
            className={`mt-1 space-y-3 border-t pt-4 ${isDark ? "border-gray-700/50" : "border-gray-200/70"}`}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || !editTaskTitle.trim() || !editTaskAssignee}
                className="flex-1"
              >
                {saving ? t("projects.task.saving") : t("projects.task.save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                {t("projects.task.cancel")}
              </Button>
            </div>
            {/* Destructive action, de-emphasized and visually separated. */}
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => onRequestDelete(task.id)}
                disabled={saving}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isDark
                    ? "focus-visible:ring-offset-gray-900 text-red-400 hover:bg-red-500/10"
                    : "focus-visible:ring-offset-white text-red-600 hover:bg-red-50"
                }`}
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                {t("projects.task.delete")}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </Modal>
  );
};
