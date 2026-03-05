const ACTION_CENTER_START_EXPANDED_KEY = "triologue_action_center_start_expanded";

export const getActionCenterStartExpanded = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ACTION_CENTER_START_EXPANDED_KEY) === "1";
};

export const setActionCenterStartExpanded = (expanded: boolean): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ACTION_CENTER_START_EXPANDED_KEY,
    expanded ? "1" : "0",
  );
};
