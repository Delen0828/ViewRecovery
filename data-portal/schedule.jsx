import React, { useState, useId, useRef, useEffect } from "react";
import {
  Calendar,
  Button,
  DatePicker,
  Select,
  SelectItem,
  Tooltip,
} from "@heroui/react";
import { parseAbsolute } from "@internationalized/date";
import {
  Plus,
  Trash2,
  Save,
  Upload,
  Download,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import {
  Panel,
  Empty,
  Notice,
  SessionChip,
  todayET,
  TIME_ZONE,
  dateKey,
  dateLabel,
  timeLabel,
  api,
} from "./ui.jsx";
import { STUDY_TASKS } from "../src/study-setup.js";

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
      const color = events.some((row) => row.session_type === "study")
        ? "#2563eb"
        : "#7c8799";
      marks.push(
        `.${className} [role="button"][aria-label*="${label}"]::after{content:"";position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:${color}}`,
      );
      marks.push(
        `.${className} [role="button"][aria-label*="${label}"][data-selected="true"]::after{background:white}`,
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
      <div className="calendar-legend">
        <span>
          <i className="session-dot" /> Study
        </span>
        <span>
          <i className="session-dot break" /> Break
        </span>
        <span className="muted">Eastern Time</span>
      </div>
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
        {next && <SessionChip type={next.session_type} />}
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
export default function ScheduleEditor({
  schedule,
  onSaved,
  onImported,
  onDirtyChange,
}) {
  const [rows, setRows] = useState(schedule.sessions),
    [day, setDay] = useState(todayET()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const upload = useRef(null);
  useEffect(() => {
    setRows(schedule.sessions);
  }, [schedule]);
  const changed = JSON.stringify(rows) !== JSON.stringify(schedule.sessions);
  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const update = (id, key, value) => {
    setRows((current) =>
      current.map((row) =>
        row.session_id === id ? { ...row, [key]: value } : row,
      ),
    );
    setMessage("");
  };
  const add = () => {
    const selected = day.toDate(TIME_ZONE);
    const start = parseAbsolute(selected.toISOString(), TIME_ZONE).set({
      hour: 10,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    setRows((current) => [
      ...current,
      {
        session_id: crypto.randomUUID(),
        user_id: schedule.user_id,
        starts_at: start.toAbsoluteString(),
        ends_at: start.add({ minutes: 30 }).toAbsoluteString(),
        session_type: "study",
        task_type: "Motion",
      },
    ]);
    setMessage("");
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/data-portal/api/schedule", {
        method: "PUT",
        body: JSON.stringify({
          user_id: schedule.user_id,
          version: schedule.version,
          sessions: rows,
        }),
      });
      onSaved(result);
      setRows(result.sessions);
      setMessage("Schedule saved. The participant calendar is updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/data-portal/api/schedule/import", {
        method: "POST",
        body: JSON.stringify({ csv: await file.text() }),
      });
      await onImported();
      setMessage(`${result.imported} sessions imported.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };
  const preview = rows.filter((row) => row.starts_at && row.ends_at);
  return (
    <div className="panel-stack">
      <Panel
        title="Calendar preview"
        subtitle="Preview the selected user’s sessions in Eastern Time."
        className="schedule-preview"
      >
        <div className="calendar-preview-layout">
          <ScheduleCalendar sessions={preview} day={day} onChange={setDay} />
          <Agenda sessions={preview} day={day} />
        </div>
      </Panel>
      <Panel
        title="Sessions"
        subtitle={`${rows.length} sessions · User ${schedule.user_id}`}
        actions={
          <Button
            size="sm"
            color="primary"
            startContent={<Plus size={16} />}
            onPress={add}
            isDisabled={busy}
          >
            Add session
          </Button>
        }
      >
        <Notice error>{error}</Notice>
        <Notice>{message}</Notice>
        {rows.length ? (
          <div className="session-rows">
            {rows.map((row, index) => (
              <div className="session-row" key={row.session_id}>
                <span className="session-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <DatePicker
                  label="Starts"
                  aria-label={`Session ${index + 1} starts`}
                  labelPlacement="outside"
                  value={
                    row.starts_at
                      ? parseAbsolute(row.starts_at, TIME_ZONE)
                      : null
                  }
                  onChange={(value) =>
                    update(
                      row.session_id,
                      "starts_at",
                      value?.toAbsoluteString() || "",
                    )
                  }
                  granularity="minute"
                  hideTimeZone
                  showMonthAndYearPickers
                  variant="bordered"
                  isRequired
                  isDisabled={busy}
                />
                <DatePicker
                  label="Ends"
                  aria-label={`Session ${index + 1} ends`}
                  labelPlacement="outside"
                  value={
                    row.ends_at ? parseAbsolute(row.ends_at, TIME_ZONE) : null
                  }
                  onChange={(value) =>
                    update(
                      row.session_id,
                      "ends_at",
                      value?.toAbsoluteString() || "",
                    )
                  }
                  granularity="minute"
                  hideTimeZone
                  showMonthAndYearPickers
                  variant="bordered"
                  isRequired
                  isDisabled={busy}
                />
                <Select
                  label="Session type"
                  aria-label={`Session ${index + 1} type`}
                  labelPlacement="outside"
                  selectedKeys={[row.session_type]}
                  onSelectionChange={(keys) => {
                    const value = [...keys][0];
                    if (value) update(row.session_id, "session_type", value);
                  }}
                  variant="bordered"
                  isDisabled={busy}
                >
                  <SelectItem key="study">Study</SelectItem>
                  <SelectItem key="break">Break</SelectItem>
                </Select>
                <Select
                  label="Task"
                  aria-label={`Session ${index + 1} task`}
                  labelPlacement="outside"
                  selectedKeys={[row.task_type]}
                  onSelectionChange={(keys) => {
                    const value = [...keys][0];
                    if (value) update(row.session_id, "task_type", value);
                  }}
                  variant="bordered"
                  isDisabled={busy}
                >
                  {STUDY_TASKS.map((task) => (
                    <SelectItem key={task}>{task}</SelectItem>
                  ))}
                </Select>
                <Tooltip content="Remove session">
                  <Button
                    isIconOnly
                    variant="light"
                    color="danger"
                    aria-label={`Remove session ${index + 1}`}
                    onPress={() => {
                      setRows((current) =>
                        current.filter(
                          (item) => item.session_id !== row.session_id,
                        ),
                      );
                      setMessage("");
                    }}
                    isDisabled={busy}
                  >
                    <Trash2 size={16} />
                  </Button>
                </Tooltip>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No sessions yet">
            Select a day above, then add a study session or break.
          </Empty>
        )}
        <div className="schedule-footer">
          <span className="muted">
            <Clock size={14} /> All dates and times are in Eastern Time.
          </span>
          <div className="button-row">
            <Button
              variant="flat"
              onPress={() => {
                setRows(schedule.sessions);
                setError("");
                setMessage("");
              }}
              isDisabled={!changed || busy}
            >
              Discard edits
            </Button>
            <Button
              color="primary"
              startContent={<Save size={16} />}
              onPress={save}
              isLoading={busy}
              isDisabled={!changed}
            >
              Save schedule
            </Button>
          </div>
        </div>
      </Panel>
      <Panel
        title="One CSV for every schedule"
        subtitle="Import adds sessions or updates matching session IDs across users. Export includes all users."
        className="csv-panel"
        actions={
          <div className="button-row">
            <Button
              as="a"
              href="/data-portal/api/schedule/export"
              variant="flat"
              size="sm"
              startContent={<Download size={15} />}
            >
              Export CSV
            </Button>
            <Button
              variant="flat"
              size="sm"
              startContent={<Upload size={15} />}
              onPress={() => upload.current.click()}
              isDisabled={busy || changed}
            >
              Import CSV
            </Button>
          </div>
        }
      >
        <input
          type="file"
          accept=".csv,text/csv"
          ref={upload}
          onChange={importCsv}
          hidden
        />
        <code className="csv-columns">
          session_id, user_id, starts_at, ends_at, session_type, task_type
        </code>
        <p className="muted">
          Use ISO dates with a timezone offset, such as
          2026-10-13T10:00:00-04:00. Leave session_id empty for a new session.
          Save or discard edits before importing.
        </p>
      </Panel>
    </div>
  );
}
