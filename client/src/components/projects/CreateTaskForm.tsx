import React, { useState } from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Button, Input, Select } from "../ui/primitives";
import type { TeamMember } from "../../projects/projectDomainTypes";

const PRIORITIES = ["low", "medium", "high"];

export interface CreateTaskFields {
  title: string;
  description: string;
  priority: string;
  assignedTo: string;
  reviewedBy: string | null;
  files: File[];
}

export interface CreateTaskFormProps {
  teamMemberIds: string[];
  teamMemberLookup: Map<string, TeamMember>;
  /** Initial assignee id; form resets to this value after a successful submit. */
  defaultAssigneeId: string;
  /** Called with the collected fields on submit. Throw (or reject) to signal an error; the parent is responsible for showing error toasts. */
  onSubmit: (fields: CreateTaskFields) => Promise<void>;
  onClose: () => void;
}

export const CreateTaskForm: React.FC<CreateTaskFormProps> = ({
  teamMemberIds,
  teamMemberLookup,
  defaultAssigneeId,
  onSubmit,
  onClose,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignedTo, setAssignedTo] = useState(defaultAssigneeId);
  const [reviewedBy, setReviewedBy] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark
      ? "border-gray-600/50 bg-gray-700 text-white placeholder-gray-400"
      : "border-gray-300/60 bg-white"
  } outline-none focus:ring-2 focus:ring-blue-500`;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !assignedTo) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        title,
        description,
        priority,
        assignedTo,
        reviewedBy: reviewedBy || null,
        files,
      });
      // Reset form after successful submit.
      setTitle("");
      setDescription("");
      setPriority("medium");
      setAssignedTo(defaultAssigneeId);
      setReviewedBy("");
      setFiles([]);
      onClose();
    } catch {
      // onSubmit rejected; the parent shows the error toast. Keep the form open
      // (do not call onClose) and just re-enable the button.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleFormSubmit(e)}
      className={`mb-6 rounded-lg border border-blue-500/20 p-3 sm:p-4 ${isDark ? "bg-blue-950/30" : "bg-blue-50"}`}
    >
      <label
        className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
      >
        {t("projects.task.title.placeholder")}{" "}
        <span className="text-red-400">*</span>
      </label>
      <Input
        type="text"
        placeholder={t("projects.task.title.placeholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-3"
        autoFocus
        required
      />
      <textarea
        placeholder={t("projects.task.description.placeholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className={`${textAreaCls} mb-3`}
        rows={3}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Select
          value={priority}
          onChange={(value) => setPriority(value)}
          options={PRIORITIES.map((p) => ({
            value: p,
            label: t(`projects.priority.${p}`),
          }))}
        />
        <Select
          value={assignedTo}
          onChange={(value) => setAssignedTo(value)}
          options={teamMemberIds.map((memberId) => {
            const member = teamMemberLookup.get(memberId);
            const label = member
              ? `${member.displayName} (@${member.username})`
              : memberId;
            return { value: memberId, label };
          })}
        />
        <Select
          value={reviewedBy}
          onChange={(value) => setReviewedBy(value)}
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

      <div className="mb-4">
        <div
          className={`mb-1 text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          {t("projects.task.attachments")}
        </div>
        <label
          className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
            isDark
              ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
              : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
          }`}
        >
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              if (selected.length > 0) {
                setFiles((prev) => {
                  const next = [...prev];
                  for (const file of selected) {
                    const exists = prev.some(
                      (existing) =>
                        existing.name === file.name &&
                        existing.size === file.size &&
                        existing.lastModified === file.lastModified,
                    );
                    if (!exists) next.push(file);
                  }
                  return next;
                });
              }
              e.currentTarget.value = "";
            }}
          />
          {t("projects.task.attachment.add")}
        </label>
        <div
          className={`mt-1 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {t("projects.task.attachment.createHint")}
        </div>
        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                  isDark
                    ? "border-gray-700/50 bg-gray-900 text-gray-200"
                    : "border-gray-200/60 bg-white text-gray-700"
                }`}
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className={
                    isDark
                      ? "text-red-300 hover:text-red-200"
                      : "text-red-600 hover:text-red-500"
                  }
                  onClick={() => {
                    setFiles((prev) =>
                      prev.filter((_, fileIndex) => fileIndex !== index),
                    );
                  }}
                >
                  {t("projects.task.attachment.removeSelected")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t("projects.task.creating")
            : t("projects.create")}
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (isSubmitting) return;
            setReviewedBy("");
            setFiles([]);
            onClose();
          }}
          variant="secondary"
          disabled={isSubmitting}
        >
          {t("projects.cancel")}
        </Button>
      </div>
    </form>
  );
};
