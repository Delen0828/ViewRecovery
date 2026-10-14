import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expandScheduleRows, scheduleFields } from "../src/portal-schedule.js";
import { validateScheduleRows } from "../server/portal-workspace.mjs";

const daily = (changes = {}) => ({
  session_id: randomUUID(), user_id: "P1", start_date: "2026-10-31",
  end_date: "2026-11-02", scheduled_time: "10:15", duration_minutes: 45,
  session_type: "study", task_type: "Motion", ...changes,
});

test("daily date ranges are inclusive and keep Eastern time and elapsed duration across DST", () => {
  const saved = validateScheduleRows([daily()], "P1");
  const sessions = expandScheduleRows(saved);
  assert.deepEqual(sessions.map((row) => row.starts_at), [
    "2026-10-31T14:15:00.000Z", "2026-11-01T15:15:00.000Z", "2026-11-02T15:15:00.000Z",
  ]);
  assert.equal(new Set(sessions.map((row) => row.session_id)).size, 3);
  for (const row of sessions) assert.equal(Date.parse(row.ends_at) - Date.parse(row.starts_at), 45 * 60000);
  assert.equal(saved[0].end_date, "2026-11-02");
  const spring = expandScheduleRows(validateScheduleRows([daily({ start_date: "2026-03-07", end_date: "2026-03-09" })], "P1"));
  assert.deepEqual(spring.map((row) => row.starts_at), [
    "2026-03-07T15:15:00.000Z", "2026-03-08T14:15:00.000Z", "2026-03-09T14:15:00.000Z",
  ]);
});

test("recurring overlap checks permit interleaved ranges and reject daily and overnight collisions", () => {
  const morning = daily();
  const later = daily({ scheduled_time: "11:00" });
  assert.equal(validateScheduleRows([morning, later], "P1").length, 2);
  assert.throws(() => validateScheduleRows([morning, daily({ scheduled_time: "10:30" })], "P1"), /overlap/);
  assert.throws(() => validateScheduleRows([
    daily({ scheduled_time: "23:45", duration_minutes: 60 }),
    daily({ start_date: "2026-11-01", end_date: "2026-11-01", scheduled_time: "00:15" }),
  ], "P1"), /overlap/);
});

test("single occurrences and existing timestamps retain their duration and DST instant", () => {
  const legacy = {
    session_id: randomUUID(), user_id: "P1", starts_at: "2026-11-01T06:30:00.123Z",
    ends_at: "2026-11-01T07:15:00.123Z", session_type: "study", task_type: "Motion",
  };
  const fields = scheduleFields(legacy);
  assert.equal(fields.start_date, fields.end_date);
  assert.equal(fields.scheduled_time, "01:30:00");
  const occurrences = expandScheduleRows(validateScheduleRows([fields], "P1"));
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].starts_at, legacy.starts_at);
  assert.equal(occurrences[0].ends_at, legacy.ends_at);
});

test("invalid daily definitions and excessive occurrence counts are rejected", () => {
  for (const changes of [
    { start_date: "2026-02-30" }, { end_date: "2026-10-30" },
    { scheduled_time: "25:00" }, { scheduled_time: "" },
    { duration_minutes: 0 }, { duration_minutes: -10 }, { duration_minutes: "" },
    { duration_minutes: {} },
  ]) assert.throws(() => validateScheduleRows([daily(changes)], "P1"));
  assert.throws(() => validateScheduleRows([daily({ end_date: "2040-11-01" })], "P1"), /5,000/);
});
