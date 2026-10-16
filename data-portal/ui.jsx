import React, { useEffect, useRef, useState } from "react";
import { Card, CardBody, Chip, Button, Checkbox, CheckboxGroup } from "@heroui/react";
import { Inbox, RefreshCw } from "lucide-react";
import { parseAbsolute, today } from "@internationalized/date";
import { TASK_COLORS, BREAK_COLOR, sessionColor } from "./task-colors.js";
import { DASHBOARD_STATS, DEFAULT_DASHBOARD_STATS } from "../src/portal-analytics.js";
export const TIME_ZONE = "America/New_York";
export const todayET = () => today(TIME_ZONE);
export const dateKey = (value) =>
  parseAbsolute(value, TIME_ZONE).toString().slice(0, 10);
export const dateLabel = (value, options = {}) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(value));
export const timeLabel = (value) =>
  dateLabel(value, {
    month: undefined,
    day: undefined,
    year: undefined,
    hour: "numeric",
    minute: "2-digit",
  });
export const durationLabel = (ms) =>
  !Number.isFinite(Number(ms))
    ? "—"
    : Number(ms) < 60000
      ? `${Math.round(Number(ms) / 1000)} sec`
      : `${Math.round(Number(ms) / 60000)} min`;
export const percentage = (value) =>
  Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : "—";
export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Could not read the server response." }));
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/auth/"))
      window.dispatchEvent(new Event("portal-session-expired"));
    throw new Error(data.message || data.error || "Request failed.");
  }
  return data;
}
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  ...props
}) {
  return (
    <Card shadow="none" className={`panel ${className}`} {...props}>
      <CardBody className="panel-body">
        {title && (
          <div className="panel-heading">
            <div>
              <h2>{title}</h2>
              {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            {actions}
          </div>
        )}
        {children}
      </CardBody>
    </Card>
  );
}
export function Empty({ title = "Nothing here yet", children, action }) {
  return (
    <div className="empty-state">
      <Inbox size={26} strokeWidth={1.5} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Notice({ error, children }) {
  return children ? (
    <div
      className={`notice ${error ? "error" : "success"}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
}
export function SessionChip({ type, task }) {
  const color = sessionColor({ session_type: type, task_type: task });
  return (
    <Chip
      size="sm"
      variant="flat"
      color={type === "break" ? "default" : "primary"}
      style={task ? { backgroundColor: `${color}18`, color } : undefined}
    >
      {type === "break" ? "Break" : "Study"}
    </Chip>
  );
}
export function ScheduleLegend({ children }) {
  return (
    <div className="calendar-legend">
      {Object.entries(TASK_COLORS).map(([task, color]) => (
        <span key={task}><i className="session-dot" style={{ background: color }} />{task}</span>
      ))}
      <span><i className="session-dot" style={{ background: BREAK_COLOR }} />Break</span>
      {children && <span className="muted">{children}</span>}
    </div>
  );
}
export function Stats({ summary, preferences, onPreferences }) {
  const selected = preferences?.dashboard_stats || DEFAULT_DASHBOARD_STATS;
  const [draft, setDraft] = useState(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settings = useRef(null);
  useEffect(() => {
    setDraft(selected);
    setError("");
  }, [preferences]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/data-portal/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ user_id: preferences.user_id, dashboard_stats: draft }),
      });
      onPreferences(result);
      settings.current.open = false;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const values = {
    sessions: (summary?.sessions || 0).toLocaleString(),
    trials: (summary?.trials || 0).toLocaleString(),
    average_study_time: summary?.sessions
      ? durationLabel((summary.trainingMs || 0) / summary.sessions) : "—",
    average_accuracy: summary?.trials ? percentage(summary.accuracy) : "—",
    total_study_time: durationLabel(summary?.trainingMs || 0),
  };
  return (
    <div className="stats-section">
      {preferences && onPreferences && (
        <details className="stats-settings" ref={settings}>
          <summary>Configure cards</summary>
          <div className="stats-options">
            <p className="muted">Choose up to four cards.</p>
            <CheckboxGroup aria-label="Summary cards" value={draft} onValueChange={setDraft} isDisabled={busy}>
              {DASHBOARD_STATS.map(({ id, label }) => (
                <Checkbox key={id} value={id} size="sm" isDisabled={draft.length >= 4 && !draft.includes(id)}>{label}</Checkbox>
              ))}
            </CheckboxGroup>
            <Notice error>{error}</Notice>
            <Button size="sm" color="primary" onPress={save} isLoading={busy} isDisabled={!draft.length}>Save cards</Button>
          </div>
        </details>
      )}
      <div className="stats-grid" style={{ "--stat-count": selected.length }}>
        {selected.map((id) => {
          const stat = DASHBOARD_STATS.find((item) => item.id === id);
          return (
            <Panel key={id} className="stat" data-stat={id}>
              <span className="stat-label">{stat.label}</span>
              <strong className="stat-value">{values[id]}</strong>
              {stat.detail && <span className="stat-detail">{stat.detail}</span>}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
export function Brand() {
  return (
    <a
      href="/data-portal/"
      className="brand"
      aria-label="BRIGHT Data Portal"
    >
      <img className="brand-logo" src="/img/vpp.png" alt="VPP lab" />
      <span>
        BRIGHT<small>Data Portal</small>
      </span>
    </a>
  );
}
export function PageTitle({ title, subtitle, actions }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}
export function RefreshButton({ onPress, isLoading }) {
  return (
    <Button
      size="sm"
      variant="flat"
      className="portal-refresh"
      aria-label="Refresh"
      onPress={onPress}
      isLoading={isLoading}
      startContent={!isLoading && <RefreshCw size={16} />}
    >
      <span className="refresh-label">Refresh</span>
    </Button>
  );
}
