export const TASK_COLORS = {
  Motion: "#2563eb",
  Orientation: "#059669",
  Centrality: "#d97706",
  Bar: "#7c3aed",
};

export const BREAK_COLOR = "#7c8799";

export function sessionColor(session) {
  return session.session_type === "break"
    ? BREAK_COLOR
    : TASK_COLORS[session.task_type] || TASK_COLORS.Motion;
}
