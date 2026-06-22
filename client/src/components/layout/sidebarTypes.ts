import type React from 'react';

export interface NavItem {
  key?: string;
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  match: (path: string) => boolean;
  available: boolean;
  adminOnly?: boolean;
}
