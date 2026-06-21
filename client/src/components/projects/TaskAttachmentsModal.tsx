import React, { useId } from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Modal } from "../ui/Modal";
import { Badge, Button, Card, SectionHeader } from "../ui/primitives";
import { authFileUrl } from "../../lib/fileUrl";
import { formatFileSize } from "../../lib/projectUtils";
import type { Task } from "../../projects/projectDomainTypes";
import type { User } from "../../stores/authStore";

export interface TaskAttachmentsModalProps {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  isTeamMember: boolean;
  isOwner: boolean;
  user: User | null;
  uploading: Record<string, boolean>;
  deleting: Record<string, boolean>;
  onUpload: (taskId: string, files: File[]) => void;
  onDelete: (taskId: string, attachmentId: string) => void;
}

export const TaskAttachmentsModal: React.FC<TaskAttachmentsModalProps> = ({
  open,
  onClose,
  task,
  isTeamMember,
  isOwner,
  user,
  uploading,
  deleting,
  onUpload,
  onDelete,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const titleId = useId();

  if (!task) return null;

  const isUploading = uploading[task.id] ?? false;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledById={titleId}
      closeOnEscape={!isUploading}
      closeOnBackdrop={!isUploading}
      className="w-full max-w-2xl mx-4"
    >
      <Card
        className={`p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
      >
        <SectionHeader
          title={
            <span id={titleId}>{t("projects.task.attachment.manage")}</span>
          }
          className="mb-3"
          actions={
            <>
              <Badge variant="neutral">
                {task.attachments?.length || 0}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onClose}
              >
                {t("projects.task.attachment.close")}
              </Button>
            </>
          }
        />

        <div
          className={`mb-3 text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}
        >
          {task.title}
        </div>

        {isTeamMember && (
          <div className="mb-4">
            <label
              className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                isDark
                  ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
                  : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
              } ${isUploading ? "pointer-events-none opacity-70" : ""}`}
            >
              <input
                type="file"
                multiple
                className="hidden"
                disabled={isUploading}
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  if (selected.length > 0) {
                    onUpload(task.id, selected);
                  }
                  e.currentTarget.value = "";
                }}
              />
              {isUploading
                ? t("projects.task.attachment.uploading")
                : t("projects.task.attachment.add")}
            </label>
          </div>
        )}

        {task.attachments && task.attachments.length > 0 ? (
          <div className="space-y-2">
            {task.attachments.map((attachment) => {
              const deleteKey = `${task.id}:${attachment.id}`;
              const isDeletingAttachment = deleting[deleteKey];
              const canDeleteAttachment = Boolean(
                user &&
                  (isOwner ||
                    user.id === task.assignedTo ||
                    user.id === attachment.uploadedBy),
              );

              return (
                <div
                  key={attachment.id}
                  className={`flex flex-col sm:flex-row gap-2 rounded border p-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-gray-50"}`}
                >
                  <a
                    href={authFileUrl(attachment.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 min-w-0 rounded border px-2 py-1 text-xs transition-colors duration-200 ${
                      isDark
                        ? "border-gray-700/50 bg-gray-800 hover:bg-gray-700 text-blue-300"
                        : "border-gray-200/60 bg-white hover:bg-gray-50 text-blue-600"
                    }`}
                    title={attachment.filename}
                  >
                    <div className="truncate">{attachment.filename}</div>
                    <div
                      className={isDark ? "text-gray-400" : "text-gray-500"}
                    >
                      {formatFileSize(attachment.size)}
                    </div>
                  </a>
                  {canDeleteAttachment && (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                      onClick={() => onDelete(task.id, attachment.id)}
                      disabled={Boolean(isDeletingAttachment)}
                    >
                      {isDeletingAttachment
                        ? t("projects.task.attachment.deleting")
                        : t("projects.task.attachment.delete")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={`rounded border border-dashed px-3 py-6 text-center text-sm ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-400"}`}
          >
            {t("projects.task.attachment.empty")}
          </div>
        )}

        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={onClose}
          >
            {t("projects.task.attachment.close")}
          </Button>
        </div>
      </Card>
    </Modal>
  );
};
