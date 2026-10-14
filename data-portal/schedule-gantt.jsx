import React, { useEffect, useMemo, useRef } from "react";
import { Button, Tooltip } from "@heroui/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { parseDate, startOfWeek } from "@internationalized/date";
import { tz } from "@date-fns/tz";
import { getWeek } from "date-fns";
import { Panel, ScheduleLegend, dateKey, dateLabel, timeLabel, todayET, TIME_ZONE } from "./ui.jsx";
import { Gantt, useGanttNavigation, useGanttOccurrences } from "./reui/gantt/gantt";
import { sessionColor } from "./task-colors.js";

const DAY_WIDTH = 44;
const WEEKS = 5;
const DAYS = WEEKS * 7;
const BAR_HEIGHT = 16;
const LANE_HEIGHT = 22;
const ROW_PADDING = 6;
const WEEK_OPTIONS = { weekStartsOn: 0, firstWeekContainsDate: 1, in: tz(TIME_ZONE) };

function timelineRows(occurrences, first) {
  const last = first.add({ days: DAYS - 1 });
  const ids = [...new Set([
    ...occurrences.map((occurrence) => occurrence.event.resourceId),
  ])].sort((a, b) => a.localeCompare(b));
  return ids.map((id) => {
    const laneEnds = [];
    const bars = occurrences.filter((occurrence) => occurrence.event.resourceId === id).flatMap((occurrence) => {
      const row = occurrence.event.data;
      try {
        const start = parseDate(dateKey(occurrence.start.toISOString()));
        const end = parseDate(dateKey(new Date(occurrence.end.getTime() - 1).toISOString()));
        if (end.compare(start) < 0 || end.compare(first) < 0 || start.compare(last) > 0) return [];
        const clippedStart = start.compare(first) < 0 ? first : start;
        const clippedEnd = end.compare(last) > 0 ? last : end;
        return [{ row, start, end, left: clippedStart.compare(first), days: clippedEnd.compare(clippedStart) + 1 }];
      } catch {
        return [];
      }
    }).sort((a, b) => a.left - b.left);
    for (const bar of bars) {
      let lane = laneEnds.findIndex((end) => end < bar.left);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = bar.left + bar.days - 1;
      bar.lane = lane;
    }
    return { id, bars, height: BAR_HEIGHT + (laneEnds.length - 1) * LANE_HEIGHT + ROW_PADDING * 2 };
  }).filter((row) => row.bars.length);
}

function sessionDescription(row) {
  const type = row.session_type === "break" ? "Break" : "Study";
  if (!row.start_date) return `${row.task_type} ${type} · ${timeLabel(row.starts_at)} – ${timeLabel(row.ends_at)} ET`;
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(row.scheduled_time || ""))
    return `${row.task_type} ${type} · Set scheduled time`;
  const [hour, minute] = row.scheduled_time.split(":").map(Number);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  return `${row.task_type} ${type} · ${time} ET · ${row.duration_minutes} min${row.start_date !== row.end_date ? " daily" : ""}`;
}

function ScheduleTimeline({ users }) {
  const { date, goTo } = useGanttNavigation();
  const today = todayET();
  const anchor = parseDate(dateKey(date.toISOString()));
  const scroll = useRef(null);
  const first = startOfWeek(anchor, "en-US", "sun").subtract({ weeks: 1 });
  const days = Array.from({ length: DAYS }, (_, index) => first.add({ days: index }));
  const occurrences = useGanttOccurrences({ start: first.toDate(TIME_ZONE), end: first.add({ days: DAYS }).toDate(TIME_ZONE) });
  const rows = timelineRows(occurrences, first);
  const userNames = new Map(users.map((user) => [user.user_id, user.name || user.user_id]));
  const todayOffset = today.compare(first);
  const centerAnchor = (behavior = "auto") => {
    const node = scroll.current;
    if (node) node.scrollTo({ left: Math.max(0, ((anchor.compare(first) + 0.5) * DAY_WIDTH) - node.clientWidth / 2), behavior });
  };
  useEffect(() => {
    centerAnchor();
    const node = scroll.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) {
        width = node.clientWidth;
        centerAnchor();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor.toString()]);
  return (
    <Panel
      title="Calendar preview"
      subtitle="Scheduled users · Five weeks, Sunday–Saturday · Eastern Time"
      className="schedule-preview"
      actions={
        <div className="button-row">
          <Button isIconOnly size="sm" variant="flat" aria-label="Previous five weeks"
            onPress={() => goTo(anchor.subtract({ days: DAYS }).toDate(TIME_ZONE))}><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="flat" startContent={<CalendarDays size={15} />}
            onPress={() => { goTo(todayET().toDate(TIME_ZONE)); centerAnchor("smooth"); }}>
            Today
          </Button>
          <Button isIconOnly size="sm" variant="flat" aria-label="Next five weeks"
            onPress={() => goTo(anchor.add({ days: DAYS }).toDate(TIME_ZONE))}><ChevronRight size={16} /></Button>
        </div>
      }
    >
      <div className="gantt-scroll" ref={scroll} role="region" aria-label="Scheduled users Gantt chart" tabIndex={0}>
        <div className="gantt-canvas" style={{ width: DAYS * DAY_WIDTH, "--gantt-day-width": `${DAY_WIDTH}px` }}>
          <div className="gantt-header">
            <div className="gantt-week-row">
              {Array.from({ length: WEEKS }, (_, index) => (
                <div className="gantt-week" key={index} style={{ width: DAY_WIDTH * 7 }}
                  title={`${dateLabel(days[index * 7].toDate(TIME_ZONE))} – ${dateLabel(days[index * 7 + 6].toDate(TIME_ZONE))}`}>
                  Week {getWeek(days[index * 7].toDate(TIME_ZONE), WEEK_OPTIONS)}
                </div>
              ))}
            </div>
            <div className="gantt-day-row">
              {days.map((date) => (
                <div className={`gantt-day ${date.compare(today) === 0 ? "is-today" : ""}`} key={date.toString()} data-date={date.toString()}>
                  <span>{dateLabel(date.toDate(TIME_ZONE), { weekday: "short", month: undefined, day: undefined, year: undefined })}</span>
                  <strong>{dateLabel(date.toDate(TIME_ZONE), { year: undefined })}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="gantt-body" style={{ minHeight: 3 * (BAR_HEIGHT + ROW_PADDING * 2) }}>
            {todayOffset >= 0 && todayOffset < DAYS && <div className="gantt-today-line" style={{ left: todayOffset * DAY_WIDTH }} />}
            {rows.map(({ id, bars, height }) => (
              <div className="gantt-user-row" key={id} style={{ height }} data-user-id={id}>
                <div className="gantt-track">
                  {bars.map(({ row, start, end, left, days: span, lane }) => {
                    const description = sessionDescription(row);
                    const dates = `${start} – ${end}`;
                    const name = userNames.get(id) || id;
                    return (
                      <Tooltip key={row.session_id} content={`${name} · ${id} · ${dates} · ${description}`} delay={0}>
                        <div className={`gantt-bar ${row.session_type === "break" ? "break" : ""}`} tabIndex={0}
                          aria-label={`${name} · ${id} · ${dates} · ${description}`}
                          style={{ "--session-color": sessionColor(row), left: left * DAY_WIDTH + 4, width: span * DAY_WIDTH - 8, top: ROW_PADDING + lane * LANE_HEIGHT }}>
                          <span className="gantt-bar-name">{name}</span>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {!rows.length && <p className="gantt-empty muted" role="status">No schedules in this date range.</p>}
      <ScheduleLegend>Scroll horizontally to explore dates. Hover or focus a session for details.</ScheduleLegend>
    </Panel>
  );
}

export default function ScheduleGantt({ users, sessions }) {
  const events = useMemo(() => sessions.flatMap((row) => {
    try {
      // One inclusive date-range bar represents each daily schedule definition.
      const start = parseDate(row.start_date || dateKey(row.starts_at));
      const end = parseDate(row.end_date || dateKey(new Date(Date.parse(row.ends_at) - 1).toISOString()));
      if (end.compare(start) < 0) return [];
      return [{
        id: row.session_id,
        resourceId: row.user_id,
        title: sessionDescription(row),
        start: start.toDate(TIME_ZONE),
        end: end.add({ days: 1 }).toDate(TIME_ZONE),
        allDay: true,
        readOnly: true,
        color: sessionColor(row),
        data: row,
      }];
    } catch {
      return [];
    }
  }), [sessions]);
  const resources = useMemo(() => {
    const names = new Map(users.map((user) => [user.user_id, user.name || user.user_id]));
    return [...new Set(events.map((event) => event.resourceId))]
      .map((id) => ({ id, title: names.get(id) || id }));
  }, [users, events]);
  return (
    <Gantt events={events} resources={resources} timeZone={TIME_ZONE} defaultScale="month"
      defaultDate={todayET().toDate(TIME_ZONE)}
      interactions={{ drag: false, resize: false, selectSlot: false }}
      rowCheckboxes={false} selection={{ eventKeys: [], slot: null }}>
      <ScheduleTimeline users={users} />
    </Gantt>
  );
}
