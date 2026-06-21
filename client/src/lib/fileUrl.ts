import { useAuthStore } from "../stores/authStore";

/** Rewrite /uploads/file.png → /api/files/file.png?token=jwt for auth-gated access */
export function authFileUrl(url: string): string {
  if (!url?.startsWith("/uploads/")) return url;
  const filename = url.replace("/uploads/", "");
  const token = useAuthStore.getState().token;
  return `/api/files/${encodeURIComponent(filename)}${token ? `?token=${token}` : ""}`;
}
