import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { fail } from "./store.mjs";
import {
  DEFAULT_STUDY_SETUP,
  STUDY_TASKS,
  validateStudySetup,
  normalizeStudySetup,
} from "../src/study-setup.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SCHEDULE_COLUMNS = [
  "session_id",
  "user_id",
  "starts_at",
  "ends_at",
  "session_type",
  "task_type",
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
  if (!/^[A-Za-z0-9]{1,32}$/.test(id))
    fail("User ID must contain 1–32 letters or numbers.");
  const password = data.password;
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
      await participant(client, id);
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
  return { user_id: id, ...result.rows[0] };
}
export function validateScheduleRows(rows, userId) {
  if (!Array.isArray(rows) || rows.length > 5000)
    fail("A schedule can contain at most 5,000 sessions.");
  const ids = new Set();
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
      };
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (let i = 1; i < normalized.length; i++)
    if (normalized[i].starts_at < normalized[i - 1].ends_at)
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
      `INSERT INTO experiment_data.portal_schedule(session_id,user_id,starts_at,ends_at,session_type,task_type)
    VALUES($1,$2,$3,$4,$5,$6)`,
      SCHEDULE_COLUMNS.map((key) => row[key]),
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
export function parseScheduleCsv(csv) {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > 1024 * 1024)
    fail("CSV must be smaller than 1 MB.");
  const records = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const input = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else field += ch;
    } else if (ch === '"') {
      if (field || closed) fail("Malformed CSV quoting.");
      quoted = true;
    } else if (ch === "," || ch === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (ch === "\n") {
        if (row.some(Boolean)) records.push(row);
        row = [];
      }
    } else {
      if (closed) fail("Malformed CSV quoting.");
      field += ch;
    }
  }
  if (quoted) fail("Malformed CSV quoting.");
  row.push(field);
  if (row.some(Boolean)) records.push(row);
  const header = records.shift();
  if (
    !header ||
    header.length !== SCHEDULE_COLUMNS.length ||
    SCHEDULE_COLUMNS.some((key) => !header.includes(key))
  )
    fail("CSV columns: " + SCHEDULE_COLUMNS.join(", "));
  if (records.length > 5000) fail("CSV can contain at most 5,000 sessions.");
  return records.map((values) => {
    if (values.length !== header.length)
      fail("CSV row has the wrong number of columns.");
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}
export async function importScheduleCsv(pool, session, csv) {
  requireAdmin(session);
  const rows = parseScheduleCsv(csv),
    groups = new Map();
  for (const row of rows) {
    if (!/^[A-Za-z0-9]{1,32}$/.test(row.user_id))
      fail("Every CSV row needs a valid user ID.");
    if (!groups.has(row.user_id)) groups.set(row.user_id, []);
    groups.get(row.user_id).push(row);
  }
  const ids = rows.filter((row) => row.session_id).map((row) => row.session_id);
  if (new Set(ids).size !== ids.length)
    fail("Session IDs must be unique across the CSV.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock in the same order for concurrent multi-user imports.
    for (const id of [...groups.keys()].sort()) {
      await participant(client, id);
      await client.query(
        "INSERT INTO experiment_data.portal_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [id],
      );
      await client.query(
        "SELECT schedule_version FROM experiment_data.portal_preferences WHERE user_id=$1 FOR UPDATE",
        [id],
      );
      const existing = (
        await client.query(
          "SELECT * FROM experiment_data.portal_schedule WHERE user_id=$1",
          [id],
        )
      ).rows.map((row) => ({
        ...row,
        starts_at: row.starts_at.toISOString(),
        ends_at: row.ends_at.toISOString(),
      }));
      const imported = groups.get(id);
      const merged = [
        ...existing.filter(
          (row) => !imported.some((item) => item.session_id === row.session_id),
        ),
        ...imported,
      ];
      await writeSchedule(client, id, validateScheduleRows(merged, id));
    }
    await client.query("COMMIT");
    return { success: true, imported: rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function exportScheduleCsv(pool, session) {
  requireAdmin(session);
  const rows = (
    await pool.query(
      "SELECT * FROM experiment_data.portal_schedule ORDER BY user_id,starts_at,session_id",
    )
  ).rows;
  const escape = (value) =>
    '"' +
    String(value instanceof Date ? value.toISOString() : value).replaceAll(
      '"',
      '""',
    ) +
    '"';
  return (
    SCHEDULE_COLUMNS.join(",") +
    "\r\n" +
    rows
      .map((row) => SCHEDULE_COLUMNS.map((key) => escape(row[key])).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
