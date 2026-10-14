import React, { useState, useId, useMemo, useEffect } from "react";
import {
  Calendar,
  Button,
  DatePicker,
  Input,
  Select,
  SelectItem,
  Tooltip,
} from "@heroui/react";
import { parseDate } from "@internationalized/date";
import {
  Plus,
  Trash2,
  Save,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import {
  Panel,
  Empty,
  Notice,
  SessionChip,
  ScheduleLegend,
  todayET,
  TIME_ZONE,
  dateLabel,
  timeLabel,
  api,
} from "./ui.jsx";
import { STUDY_TASKS } from "../src/study-setup.js";
import { scheduleFields } from "../src/portal-schedule.js";
import { TASK_COLORS, BREAK_COLOR, sessionColor } from "./task-colors.js";

function onDay(session, day) {
  const start = day.toDate(TIME_ZONE).getTime(),
    end = day.add({ days: 1 }).toDate(TIME_ZONE).getTime();
  return (
    Date.parse(session.starts_at) < end && Date.parse(session.ends_at) > start
  );
}
export function Agenda({ sessions, day, limit = 6 }) {
  const filtered = sessions.filter((row) => onDay(row, day));
  return (
    <div className="agenda">
      <h3>{dateLabel(day.toDate(TIME_ZONE), { weekday: "short" })}</h3>
      {filtered.length ? (
        filtered.slice(0, limit).map((row) => (
          <div className="agenda-item" key={row.session_id}>
            <span
              className={`session-dot ${row.session_type === "break" ? "break" : ""}`}
              style={{ background: sessionColor(row) }}
            />
            <div>
              <strong>
                {row.task_type}{" "}
                <span className="muted">
                  · {row.session_type === "break" ? "Break" : "Study"}
                </span>
              </strong>
              <span>
                {dateLabel(row.starts_at, { year: undefined })} ·{" "}
                {timeLabel(row.starts_at)} –{" "}
                {dateLabel(row.ends_at, { year: undefined })} ·{" "}
                {timeLabel(row.ends_at)}
              </span>
            </div>
          </div>
        ))
      ) : (
        <p className="muted agenda-empty">
          No sessions scheduled for this day.
        </p>
      )}
      {filtered.length > limit && (
        <p className="muted">+{filtered.length - limit} more sessions</p>
      )}
    </div>
  );
}
export function ScheduleCalendar({ sessions, day, onChange }) {
  const [focused, setFocused] = useState(day);
  const className =
    "schedule-calendar-" +
    useId().replaceAll(":", "").replaceAll("«", "").replaceAll("»", "");
  const marks = [];
  const first = focused.set({ day: 1 }).subtract({ days: 7 });
  for (let i = 0; i < 49; i++) {
    const date = first.add({ days: i }),
      events = sessions.filter((row) => onDay(row, date));
    if (events.length) {
      const label = dateLabel(date.toDate(TIME_ZONE), { month: "long" });
      const colors = [...Object.values(TASK_COLORS), BREAK_COLOR]
        .filter((color) => events.some((row) => sessionColor(row) === color));
      const dots = colors.map((color, index) =>
        `radial-gradient(circle at ${index * 5 + 2}px 2px, ${color} 0 2px, transparent 2px)`);
      marks.push(
        `.${className} [role="button"][aria-label*="${label}"]::after{content:"";position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:${colors.length * 5 - 1}px;height:4px;border-radius:2px;background-image:${dots.join(",")}}`,
      );
      marks.push(
        `.${className} [role="button"][aria-label*="${label}"][data-selected="true"]::after{background-color:white;box-shadow:0 0 0 1px white}`,
      );
    }
  }
  return (
    <div className={`calendar-container ${className}`}>
      <style>{marks.join("\n")}</style>
      <Calendar
        aria-label="Session calendar"
        value={day}
        onChange={onChange}
        focusedValue={focused}
        onFocusChange={setFocused}
        showMonthAndYearPickers
        color="primary"
        classNames={{
          base: "portal-calendar",
          cellButton: "portal-calendar-day",
        }}
      />
      <ScheduleLegend>Eastern Time</ScheduleLegend>
    </div>
  );
}
export function DashboardCalendar({ sessions }) {
  const [day, setDay] = useState(todayET());
  return (
    <Panel
      title="Your schedule"
      subtitle="Select a day to view its sessions."
      className="dashboard-calendar"
    >
      <ScheduleCalendar sessions={sessions} day={day} onChange={setDay} />
      <Agenda sessions={sessions} day={day} />
    </Panel>
  );
}
export function NextSession({ sessions, onProgress }) {
  const now = Date.now();
  const current = sessions.find(
    (row) => Date.parse(row.starts_at) <= now && Date.parse(row.ends_at) > now,
  );
  const next =
    current || sessions.find((row) => Date.parse(row.starts_at) > now);
  return (
    <Panel className="next-session">
      <div className="next-session-copy">
        <span className="eyebrow">
          {current ? "Current session" : "Up next"}
        </span>
        <h2>
          {next
            ? `${next.task_type} ${next.session_type === "break" ? "break" : "study"}`
            : "Your next session awaits"}
        </h2>
        <p>
          {next
            ? `${dateLabel(next.starts_at, { weekday: "short" })} · ${timeLabel(next.starts_at)} – ${timeLabel(next.ends_at)} ET`
            : "Your study team will add sessions to your calendar."}
        </p>
      </div>
      <div className="next-session-actions">
        {next && <SessionChip type={next.session_type} task={next.task_type} />}
        <Button
          color="primary"
          variant="flat"
          endContent={<ArrowUpRight size={16} />}
          onPress={onProgress}
        >
          My Progress
        </Button>
      </div>
    </Panel>
  );
}
export default function ScheduleEditor({ schedule, onSaved, onPreviewChange, onDirtyChange }) {
  const savedRows = useMemo(() => schedule.sessions.map(scheduleFields), [schedule]);
  const [rows, setRows] = useState(savedRows),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => { setRows(savedRows); }, [savedRows]);
  const changed = JSON.stringify(rows) !== JSON.stringify(savedRows);
  useEffect(() => { onDirtyChange(changed); }, [changed, onDirtyChange]);
  useEffect(() => {
    onPreviewChange({ user_id: schedule.user_id, sessions: changed ? rows : schedule.sessions });
  }, [rows, changed, schedule, onPreviewChange]);
  useEffect(() => () => { onDirtyChange(false); onPreviewChange(null); }, [onDirtyChange, onPreviewChange]);
  const update = (id, key, value) => {
    setRows((current) => current.map((row) => row.session_id === id ? { ...row, [key]: value } : row));
    setMessage("");
  };
  const add = () => {
    const date = todayET().toString();
    setRows((current) => [...current, {
      session_id: crypto.randomUUID(), user_id: schedule.user_id,
      start_date: date, end_date: date, scheduled_time: "10:00", duration_minutes: 30,
      session_type: "study", task_type: "Motion",
    }]);
    setMessage("");
  };
  const save = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/data-portal/api/schedule", {
        method: "PUT",
        body: JSON.stringify({ user_id: schedule.user_id, version: schedule.version, sessions: rows }),
      });
      onSaved(result);
      setRows(result.sessions.map(scheduleFields));
      setMessage("Schedule saved. The participant calendar is updated.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <Panel title="Sessions" className="schedule-sessions"
      subtitle={`${rows.length} ${rows.length === 1 ? "session" : "sessions"} · User ${schedule.user_id} · Repeats daily from Starts through Ends`}
      actions={<Button size="sm" color="primary" startContent={<Plus size={16} />} onPress={add} isDisabled={busy}>Add session</Button>}
    >
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {rows.length ? (
        <div className="session-rows">
          {rows.map((row, index) => (
            <div className="session-row" key={row.session_id}>
              <span className="session-index">{String(index + 1).padStart(2, "0")}</span>
              <DatePicker label="Starts" aria-label={`Session ${index + 1} starts`} labelPlacement="outside"
                value={row.start_date ? parseDate(row.start_date) : null}
                onChange={(value) => update(row.session_id, "start_date", value?.toString() || "")}
                granularity="day" showMonthAndYearPickers variant="bordered" size="sm" isRequired isDisabled={busy} />
              <DatePicker label="Ends" aria-label={`Session ${index + 1} ends`} labelPlacement="outside"
                value={row.end_date ? parseDate(row.end_date) : null}
                onChange={(value) => update(row.session_id, "end_date", value?.toString() || "")}
                granularity="day" showMonthAndYearPickers variant="bordered" size="sm" isRequired isDisabled={busy} />
              <Input type="time" label="Scheduled time" aria-label={`Session ${index + 1} scheduled time`} labelPlacement="outside"
                value={row.scheduled_time} onValueChange={(value) => update(row.session_id, "scheduled_time", value)}
                variant="bordered" size="sm" isRequired isDisabled={busy} />
              <Input type="number" label="Duration" aria-label={`Session ${index + 1} duration`} labelPlacement="outside"
                value={String(row.duration_minutes)} min="0.01" step="any"
                onValueChange={(value) => update(row.session_id, "duration_minutes", value)}
                endContent={<span className="muted duration-unit">min</span>} variant="bordered" size="sm" isRequired isDisabled={busy} />
              <Select label="Session type" aria-label={`Session ${index + 1} type`} labelPlacement="outside"
                selectedKeys={[row.session_type]} onSelectionChange={(keys) => { const value = [...keys][0]; if (value) update(row.session_id, "session_type", value); }}
                variant="bordered" size="sm" isDisabled={busy}>
                <SelectItem key="study">Study</SelectItem><SelectItem key="break">Break</SelectItem>
              </Select>
              <Select label="Task" aria-label={`Session ${index + 1} task`} labelPlacement="outside"
                selectedKeys={[row.task_type]} onSelectionChange={(keys) => { const value = [...keys][0]; if (value) update(row.session_id, "task_type", value); }}
                variant="bordered" size="sm" isDisabled={busy}>
                {STUDY_TASKS.map((task) => <SelectItem key={task}>{task}</SelectItem>)}
              </Select>
              <Tooltip content="Remove session">
                <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Remove session ${index + 1}`}
                  onPress={() => { setRows((current) => current.filter((item) => item.session_id !== row.session_id)); setMessage(""); }} isDisabled={busy}>
                  <Trash2 size={16} />
                </Button>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : <Empty title="No sessions yet">Add a study session or break for this user.</Empty>}
      <div className="schedule-footer">
        <span className="muted"><Clock size={14} /> Daily sessions use Eastern Time. Duration is in minutes.</span>
        <div className="button-row">
          <Button variant="flat" onPress={() => { setRows(savedRows); setError(""); setMessage(""); }} isDisabled={!changed || busy}>Discard edits</Button>
          <Button color="primary" startContent={<Save size={16} />} onPress={save} isLoading={busy} isDisabled={!changed}>Save schedule</Button>
        </div>
      </div>
    </Panel>
  );
}
