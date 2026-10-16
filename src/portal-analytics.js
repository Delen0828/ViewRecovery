export const DASHBOARD_STATS = [
  { id: "sessions", label: "Sessions completed" },
  { id: "trials", label: "Trials completed" },
  { id: "average_study_time", label: "Avg. study time", detail: "Active training time per session" },
  { id: "average_accuracy", label: "Avg. accuracy", detail: "Across all completed responses" },
  { id: "total_study_time", label: "Cumulated study time", detail: "Total active training time" },
];

export const DEFAULT_DASHBOARD_STATS = ["sessions", "trials", "average_study_time"];

export function ordinalSession(rank) {
  const remainder = rank % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[rank % 10] || "th");
  return `${rank}${suffix} session`;
}
