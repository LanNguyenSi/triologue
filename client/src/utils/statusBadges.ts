import type { BadgeVariant } from "../components/ui/primitives";

export const projectStatusBadgeVariant = (status?: string): BadgeVariant => {
  if (status === "active") return "success";
  if (status === "archived") return "warning";
  if (status === "closed") return "danger";
  return "neutral";
};

export const taskStatusBadgeVariant = (status?: string): BadgeVariant => {
  if (status === "done") return "success";
  if (status === "blocked") return "danger";
  if (status === "in_review") return "warning";
  if (status === "in_progress") return "info";
  return "neutral";
};

export const taskPriorityBadgeVariant = (priority?: string): BadgeVariant => {
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  return "success";
};

export const activeStateBadgeVariant = (isActive: boolean): BadgeVariant => (
  isActive ? "success" : "warning"
);

