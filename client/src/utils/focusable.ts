/**
 * Selector for tabbable elements, shared by the Modal primitive and the
 * useFocusTrap hook so the two focus traps cannot drift apart.
 */
export const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
