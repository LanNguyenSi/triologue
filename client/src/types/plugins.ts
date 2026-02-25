export interface PluginNavItem {
  to: string;
  label: string;
  labelKey?: string;
  icon?: string;
  adminOnly?: boolean;
  match?: "exact" | "prefix";
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabledByDefault?: boolean;
  capabilities?: string[];
  installed?: boolean;
  enabled?: boolean;
  linked?: boolean;
  canManage?: boolean;
  policy?: {
    updatedAt?: string;
    updatedBy?: string | null;
  } | null;
  ui?: {
    navItems?: PluginNavItem[];
  };
}
