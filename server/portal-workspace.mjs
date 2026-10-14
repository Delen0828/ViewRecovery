import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { fail } from "./store.mjs";
import { expandScheduleRows, MAX_SCHEDULE_OCCURRENCES } from "../src/portal-schedule.js";
import {
  DEFAULT_STUDY_SETUP,
  STUDY_TASKS,
  validateStudySetup,
  normalizeStudySetup,
} from "../src/study-setup.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEDULE_FIELDS = [
  "session_id",
  "user_id",
  "starts_at",
  "ends_at",
  "session_type",
  "task_type",
  "start_date",
  "end_date",
  "scheduled_time",
  "duration_minutes",
];
export function requireAdmin(session) {
  if (!["admin", "user"].includes(session.role)) fail("Unauthorized", 401);
  if (session.role !== "admin") fail("Administrator access required.", 403);
}
export function scopedUser(session, requested = "") {
  if (!["admin", "user"].includes(session.role)) fail("Unauthorized", 401);
  if (session.role === "user") {
    if (requested && requested !== session.user_id) fail("Access denied.", 403);
    return session.user_id;
  }
  if (!requested) fail("Select a user.");
  return requested;
}
async function participant(client, id) {
  const result = await client.query(
    "SELECT id,username FROM portal_auth.\"user\" WHERE username=$1 AND role='user'",
    [id],
  );
  if (!result.rowCount) fail("User not found.", 404);
  return result.rows[0];
}
export async function portalUsers(pool, session) {
  requireAdmin(session);
  const result = await pool.query(`WITH owners AS (
    SELECT username AS user_id FROM portal_auth."user" WHERE role='user'
    UNION SELECT DISTINCT user_id FROM experiment_data.portal_files WHERE user_id IS NOT NULL
  ) SELECT o.user_id,coalesce(u.name,'User ' || o.user_id) AS name,u."createdAt" AS created_at,
    (u.id IS NOT NULL) AS has_account FROM owners o
    LEFT JOIN portal_auth."user" u ON u.username=o.user_id AND u.role='user' ORDER BY o.user_id`);
  return { users: result.rows };
}
export async function managePortalUser(pool, session, method, data) {
  requireAdmin(session);
  const id = String(data.user_id || "");
  const original = String(data.original_user_id || id);
  if (method === "DELETE") {
    // Existing imported identities may predate the account naming rules.
    if (!id || id.length > 100) fail("Invalid user ID.");
  } else if (!/^[A-Za-z0-9]{1,32}$/.test(id))
    fail("User ID must contain 1–32 letters or numbers.");
  const password = data.password;
  if (
    method === "DELETE" &&
    data.delete_data !== undefined &&
    typeof data.delete_data !== "boolean"
  )
    fail("Delete data must be a boolean.");
  if (method === "POST" || password) {
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      fail("Password must contain 8–128 characters.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('viewrecovery-portal-accounts-v1'))",
    );
    if (method === "DELETE") {
      const account = await client.query(
        "SELECT id FROM portal_auth.\"user\" WHERE username=$1 AND role='user'",
        [id],
      );
      if (!account.rowCount) {
        const recorded = await client.query(
          "SELECT 1 FROM experiment_data.portal_files WHERE user_id=$1 LIMIT 1",
          [id],
        );
        if (!recorded.rowCount) fail("User not found.", 404);
      }
      // A data-only user can only be removed by deleting their recorded data.
      if (data.delete_data === true || !account.rowCount) {
        const files = await client.query(
          "SELECT source_kind,source_id FROM experiment_data.portal_files WHERE user_id=$1 AND source_kind IN ('source','run')",
          [id],
        );
        const sources = files.rows
          .filter((file) => file.source_kind === "source")
          .map((file) => file.source_id);
        const runs = files.rows
          .filter((file) => file.source_kind === "run")
          .map((file) => file.source_id);
        // Lock runs against concurrent ingest before removing their dependent rows.
        await client.query(
          "SELECT id FROM experiment_data.runs WHERE id=ANY($1::uuid[]) FOR UPDATE",
          [runs],
        );
        await client.query(
          "DELETE FROM experiment_data.source_rows WHERE source_file_id=ANY($1::bigint[])",
          [sources],
        );
        await client.query(
          "DELETE FROM experiment_data.source_files WHERE id=ANY($1::bigint[])",
          [sources],
        );
        await client.query(
          "DELETE FROM experiment_data.save_rows WHERE save_id IN (SELECT id FROM experiment_data.saves WHERE run_id=ANY($1::uuid[]))",
          [runs],
        );
        await client.query(
          "DELETE FROM experiment_data.saves WHERE run_id=ANY($1::uuid[])",
          [runs],
        );
        await client.query(
          "DELETE FROM experiment_data.events WHERE run_id=ANY($1::uuid[])",
          [runs],
        );
        await client.query(
          "DELETE FROM experiment_data.ingest_batches WHERE run_id=ANY($1::uuid[])",
          [runs],
        );
        await client.query(
          "DELETE FROM experiment_data.runs WHERE id=ANY($1::uuid[])",
          [runs],
        );
      }
      await client.query(
        "INSERT INTO experiment_data.portal_retired_users(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [id],
      );
      await client.query(
        "DELETE FROM portal_auth.\"user\" WHERE username=$1 AND role='user'",
        [id],
      );
    } else if (method === "POST") {
      const existing = await client.query(
        `SELECT id FROM portal_auth."user" WHERE username=$1
        UNION ALL SELECT original_user_id FROM experiment_data.portal_user_aliases WHERE original_user_id=$1 AND current_user_id<>$1`,
        [id],
      );
      if (existing.rowCount) fail("User ID already exists.", 409);
      const accountId = randomUUID();
      await client.query(
        `INSERT INTO portal_auth."user"(id,name,email,username,role,"participantId")
        VALUES($1,$2,$3,$4,'user',$4)`,
        [
          accountId,
          `User ${id}`,
          `${Buffer.from("user:" + id).toString("hex")}@portal.invalid`,
          id,
        ],
      );
      await client.query(
        `INSERT INTO portal_auth.account(id,"accountId","providerId","userId",password)
        VALUES($1,$2,'credential',$2,$3)`,
        [randomUUID(), accountId, await hashPassword(password)],
      );
      await client.query(
        "DELETE FROM experiment_data.portal_retired_users WHERE user_id=$1",
        [id],
      );
    } else {
      const account = await participant(client, original);
      if (original !== id) {
        const conflict = await client.query(
          `SELECT username FROM portal_auth."user" WHERE username=$1
          UNION ALL SELECT user_id FROM experiment_data.portal_files WHERE user_id=$1
          UNION ALL SELECT original_user_id FROM experiment_data.portal_user_aliases WHERE original_user_id=$1 AND current_user_id<>$2 LIMIT 1`,
          [id, original],
        );
        if (conflict.rowCount)
          fail(
            "User ID is already assigned to an account or experiment data.",
            409,
          );
        await client.query(
          'UPDATE portal_auth."user" SET username=$1,"participantId"=$1,name=$2,"updatedAt"=now() WHERE id=$3',
          [id, `User ${id}`, account.id],
        );
        await client.query(
          "UPDATE experiment_data.portal_user_aliases SET current_user_id=$1 WHERE current_user_id=$2",
          [id, original],
        );
        await client.query(
          `INSERT INTO experiment_data.portal_user_aliases(original_user_id,current_user_id) VALUES($1,$2)
          ON CONFLICT(original_user_id) DO UPDATE SET current_user_id=EXCLUDED.current_user_id`,
          [original, id],
        );
        await client.query(
          "INSERT INTO experiment_data.portal_retired_users(user_id) VALUES($1) ON CONFLICT DO NOTHING",
          [original],
        );
        await client.query(
          "DELETE FROM experiment_data.portal_retired_users WHERE user_id=$1",
          [id],
        );
      }
      if (password)
        await client.query(
          'UPDATE portal_auth.account SET password=$1,"updatedAt"=now() WHERE "userId"=$2 AND "providerId"=\'credential\'',
          [await hashPassword(password), account.id],
        );
      if (password || original !== id)
        await client.query(
          'DELETE FROM portal_auth.session WHERE "userId"=$1',
          [account.id],
        );
    }
    await client.query("COMMIT");
    return { success: true, user_id: id };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") fail("User ID or account already exists.", 409);
    throw error;
  } finally {
    client.release();
  }
}
export async function portalPreferences(pool, session, requested) {
  const id = scopedUser(session, requested);
  await participant(pool, id);
  const result = await pool.query(
    "SELECT setup,dashboard_charts,updated_at FROM experiment_data.portal_preferences WHERE user_id=$1",
    [id],
  );
  return {
    user_id: id,
    setup: result.rows[0]?.setup || { ...DEFAULT_STUDY_SETUP },
    setup_saved: !!result.rows[0]?.setup,
    dashboard_charts: result.rows[0]?.dashboard_charts || [
      "accuracy",
      "duration",
    ],
    updated_at: result.rows[0]?.updated_at || null,
  };
}
export async function savePortalPreferences(pool, session, data) {
  const id = scopedUser(session, data.user_id);
  await participant(pool, id);
  if (data.setup !== undefined) {
    const error = validateStudySetup(data.setup);
    if (error) fail(error);
    await pool.query(
      `INSERT INTO experiment_data.portal_preferences(user_id,setup) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET setup=EXCLUDED.setup,updated_at=now()`,
      [id, normalizeStudySetup(data.setup)],
    );
  }
  if (data.dashboard_charts !== undefined) {
    if (
      !Array.isArray(data.dashboard_charts) ||
      data.dashboard_charts.some(
        (value) => !["accuracy", "duration"].includes(value),
      ) ||
      new Set(data.dashboard_charts).size !== data.dashboard_charts.length
    )
      fail("Invalid dashboard chart selection.");
    await pool.query(
      `INSERT INTO experiment_data.portal_preferences(user_id,dashboard_charts) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET dashboard_charts=EXCLUDED.dashboard_charts,updated_at=now()`,
      [id, JSON.stringify(data.dashboard_charts)],
    );
  }
  return portalPreferences(pool, session, id);
}
export async function portalSchedule(pool, session, requested) {
  const id = scopedUser(session, requested);
  await participant(pool, id);
  // One statement snapshot keeps sessions and the optimistic revision together.
  const result = await pool.query(
    `SELECT coalesce(p.schedule_version,0) AS version,
    coalesce((SELECT jsonb_agg(s ORDER BY s.starts_at,s.session_id) FROM experiment_data.portal_schedule s WHERE s.user_id=u.username),'[]') AS sessions
    FROM portal_auth."user" u LEFT JOIN experiment_data.portal_preferences p ON p.user_id=u.username WHERE u.username=$1`,
    [id],
  );
  const schedule = { user_id: id, ...result.rows[0] };
  if (session.role !== "admin") schedule.sessions = expandScheduleRows(schedule.sessions);
  return schedule;
}
export async function portalScheduleOverview(pool, session) {
  requireAdmin(session);
  const result = await pool.query(
    `SELECT coalesce(jsonb_agg(s ORDER BY s.user_id,s.starts_at,s.session_id),'[]') AS sessions
     FROM experiment_data.portal_schedule s`,
  );
  return result.rows[0];
}
export function validateScheduleRows(rows, userId) {
  if (!Array.isArray(rows) || rows.length > 5000)
    fail("A schedule can contain at most 5,000 sessions.");
  const ids = new Set();
  let occurrenceCount = 0;
  const normalized = rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        fail("Invalid session row.");
      const session_id = row.session_id || randomUUID();
      if (!UUID.test(session_id) || ids.has(session_id))
        fail("Session IDs must be unique UUIDs.");
      ids.add(session_id);
      if (row.user_id && row.user_id !== userId)
        fail("Session belongs to another user.");
      const recurring = ["start_date", "end_date", "scheduled_time", "duration_minutes"]
        .some((key) => row[key] !== undefined && row[key] !== null);
      let recurrence = {};
      if (recurring) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(row.start_date || "") ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.end_date || "") ||
          !/^\d{2}:\d{2}(?::\d{2})?$/.test(row.scheduled_time || "") ||
          !["number", "string"].includes(typeof row.duration_minutes)
        ) fail("Select valid Starts and Ends dates, Scheduled time, and Duration.");
        recurrence = {
          start_date: row.start_date,
          end_date: row.end_date,
          scheduled_time: row.scheduled_time,
          duration_minutes: Number(row.duration_minutes),
        };
        try {
          const occurrences = expandScheduleRows([{ ...row, ...recurrence }], MAX_SCHEDULE_OCCURRENCES - occurrenceCount);
          occurrenceCount += occurrences.length;
          row = { ...row, starts_at: occurrences[0].starts_at, ends_at: occurrences.at(-1).ends_at };
        } catch (error) {
          fail(error.message.includes("at most") ? "A schedule can contain at most 5,000 sessions." : error.message);
        }
      } else occurrenceCount++;
      if (occurrenceCount > MAX_SCHEDULE_OCCURRENCES)
        fail("A schedule can contain at most 5,000 sessions.");
      for (const key of ["starts_at", "ends_at"]) {
        if (
          typeof row[key] !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            row[key],
          ) ||
          !Number.isFinite(Date.parse(row[key]))
        )
          fail("Session dates must include a time and timezone offset.");
        const date = row[key].slice(0, 10);
        if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
          fail("Invalid session date.");
      }
      if (Date.parse(row.ends_at) <= Date.parse(row.starts_at))
        fail("End time must be after start time.");
      if (
        !["study", "break"].includes(row.session_type) ||
        !STUDY_TASKS.includes(row.task_type)
      )
        fail("Select a valid session type and task.");
      return {
        session_id,
        user_id: userId,
        starts_at: new Date(row.starts_at).toISOString(),
        ends_at: new Date(row.ends_at).toISOString(),
        session_type: row.session_type,
        task_type: row.task_type,
        ...recurrence,
      };
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  let occurrences;
  try {
    occurrences = expandScheduleRows(normalized);
  } catch (error) {
    fail(error.message);
  }
  for (let i = 1; i < occurrences.length; i++)
    if (occurrences[i].starts_at < occurrences[i - 1].ends_at)
      fail("Sessions cannot overlap for the same user.");
  return normalized;
}
async function writeSchedule(client, id, sessions, version) {
  await participant(client, id);
  await client.query(
    "INSERT INTO experiment_data.portal_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [id],
  );
  const current = await client.query(
    "SELECT schedule_version FROM experiment_data.portal_preferences WHERE user_id=$1 FOR UPDATE",
    [id],
  );
  if (version !== undefined && version !== current.rows[0].schedule_version)
    fail("Schedule changed. Refresh before saving your edits.", 409);
  const collisions = await client.query(
    "SELECT session_id FROM experiment_data.portal_schedule WHERE session_id=ANY($1::uuid[]) AND user_id<>$2",
    [sessions.map((row) => row.session_id), id],
  );
  if (collisions.rowCount) fail("A session ID belongs to another user.", 409);
  await client.query(
    "DELETE FROM experiment_data.portal_schedule WHERE user_id=$1",
    [id],
  );
  for (const row of sessions)
    await client.query(
      `INSERT INTO experiment_data.portal_schedule(session_id,user_id,starts_at,ends_at,session_type,task_type,start_date,end_date,scheduled_time,duration_minutes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      SCHEDULE_FIELDS.map((key) => row[key] ?? null),
    );
  await client.query(
    "UPDATE experiment_data.portal_preferences SET schedule_version=schedule_version+1,updated_at=now() WHERE user_id=$1",
    [id],
  );
}
export async function savePortalSchedule(pool, session, data) {
  requireAdmin(session);
  const id = scopedUser(session, data.user_id);
  if (!Number.isSafeInteger(data.version) || data.version < 0)
    fail("Schedule revision is required.");
  const sessions = validateScheduleRows(data.sessions, id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeSchedule(client, id, sessions, data.version);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return portalSchedule(pool, session, id);
}
