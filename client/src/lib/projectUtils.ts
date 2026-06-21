/**
 * Utility helpers shared across project-related components.
 */

export const formatFileSize = (size?: number | null): string => {
  if (!size || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};
