import {
  parseAbsolute,
  parseDate,
  parseTime,
  toCalendarDate,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";

export const SCHEDULE_TIME_ZONE = "America/New_York";
export const MAX_SCHEDULE_OCCURRENCES = 5000;

// Existing timestamp-only sessions become a single occurrence without changing
// their start instant or elapsed duration when opened in the editor.
export function scheduleFields(row) {
  if (row.start_date) return row;
  const start = parseAbsolute(row.starts_at, SCHEDULE_TIME_ZONE);
  const date = toCalendarDate(start).toString();
  return {
    ...row,
    start_date: date,
    end_date: date,
    scheduled_time: [start.hour, start.minute, start.second]
      .map((value) => String(value).padStart(2, "0"))
      .join(":"),
    duration_minutes: (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000,
  };
}

export function expandScheduleRows(rows, limit = MAX_SCHEDULE_OCCURRENCES) {
  const sessions = [];
  for (const row of rows) {
    if (!row.start_date) {
      sessions.push(row);
    } else {
      const first = parseDate(row.start_date);
      const last = parseDate(row.end_date);
      const time = parseTime(row.scheduled_time);
      if (last.compare(first) < 0) throw new Error("Ends date must be on or after Starts date.");
      const minutes = Number(row.duration_minutes);
      if (!Number.isFinite(minutes) || minutes <= 0)
        throw new Error("Duration must be greater than zero.");
      if (sessions.length + last.compare(first) + 1 > limit)
        throw new Error(`A schedule can contain at most ${limit.toLocaleString("en-US")} sessions.`);
      const original = row.starts_at ? parseAbsolute(row.starts_at, SCHEDULE_TIME_ZONE) : null;
      for (let date = first; date.compare(last) <= 0; date = date.add({ days: 1 })) {
        // Calendar arithmetic keeps the local scheduled time stable across DST;
        // elapsed arithmetic keeps each occurrence's duration precise.
        const local = toCalendarDateTime(date, time);
        let start = toZoned(local, SCHEDULE_TIME_ZONE);
        if (original) {
          if (toCalendarDateTime(original).set({ millisecond: 0 }).compare(local) === 0)
            start = original;
        }
        sessions.push({
          ...row,
          session_id: `${row.session_id}:${date}`,
          starts_at: start.toAbsoluteString(),
          ends_at: new Date(start.toDate().getTime() + minutes * 60000).toISOString(),
        });
        if (sessions.length > limit)
          throw new Error(`A schedule can contain at most ${limit.toLocaleString("en-US")} sessions.`);
      }
    }
    if (sessions.length > limit)
      throw new Error(`A schedule can contain at most ${limit.toLocaleString("en-US")} sessions.`);
  }
  return sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
