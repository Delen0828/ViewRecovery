import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { openDatabase } from "../scripts/lib/postgres.mjs";
import { createServer } from "../server/index.mjs";
import { portalClient } from "./portal-auth-client.mjs";
import { migratePortalAccounts } from "../server/portal-accounts.mjs";
import {
  SCHEDULE_COLUMNS,
  parseScheduleCsv,
  validateScheduleRows,
} from "../server/portal-workspace.mjs";
import { DEFAULT_STUDY_SETUP, studyCalibration } from "../src/study-setup.js";
import { ingest } from "../server/store.mjs";

test("schedule CSV validates quoting, timestamps, and conflicts", () => {
  const row = {
    session_id: randomUUID(),
    user_id: "P1",
    starts_at: "2026-11-01T01:00:00-04:00",
    ends_at: "2026-11-01T01:30:00-05:00",
    session_type: "study",
    task_type: "Motion",
  };
  const csv =
    "\uFEFF" +
    SCHEDULE_COLUMNS.join(",") +
    "\r\n" +
    SCHEDULE_COLUMNS.map((key) => '"' + row[key] + '"').join(",") +
    "\r\n";
  assert.deepEqual(parseScheduleCsv(csv), [row]);
  assert.equal(
    Date.parse(validateScheduleRows([row], "P1")[0].ends_at) -
      Date.parse(validateScheduleRows([row], "P1")[0].starts_at),
    90 * 60000,
  );
  assert.throws(() => parseScheduleCsv("not,the,header"), /CSV columns/);
  assert.throws(
    () => parseScheduleCsv(SCHEDULE_COLUMNS.join(",") + '\n"unclosed'),
    /quoting/,
  );
  assert.throws(
    () =>
      validateScheduleRows(
        [{ ...row, starts_at: "2026-02-30T10:00:00Z" }],
        "P1",
      ),
    /Invalid session date/,
  );
  assert.throws(
    () =>
      validateScheduleRows(
        [{ ...row, starts_at: "2026-10-13T10:00:00" }],
        "P1",
      ),
    /timezone/,
  );
  assert.throws(
    () =>
      validateScheduleRows([row, { ...row, session_id: randomUUID() }], "P1"),
    /overlap/,
  );
  assert.throws(() => validateScheduleRows([row, row], "P1"), /unique/);
});

test("portal workspace persists scoped preferences, account changes and synchronized schedules", async (t) => {
  const pool = await openDatabase();
  let server;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8),
    first = "W" + suffix,
    second = "X" + suffix,
    renamed = "R" + suffix,
    adminId = "workspace-admin-" + suffix;
  const run = {
    id: randomUUID(),
    user_id: first,
    task: "Motion",
    run_timestamp: "2026-10-13T14-00-00",
  };
  const authOptions = {
    adminUsername: adminId,
    adminPasswordHash: bcrypt.hashSync("workspace-password", 4),
    maxAttempts: 100,
  };
  try {
    server = createServer(pool, { portalAuth: authOptions });
    await server.portalAuthReady;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`,
      admin = portalClient(base),
      user = portalClient(base),
      other = portalClient(base),
      anonymous = portalClient(base);
    assert.equal(
      (await admin.login(adminId, "workspace-password", "admin")).response
        .status,
      200,
    );
    const mutation = (client, path, method, data, headers = {}) =>
      client.api(path, {
        method,
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
      });
    await t.test(
      "admin creates users; users cannot manage accounts or schedules",
      async () => {
        for (const id of [first, second])
          assert.equal(
            (
              await mutation(admin, "/data-portal/api/users", "POST", {
                user_id: id,
                password: "participant-password",
              })
            ).status,
            200,
          );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/users", "POST", {
              user_id: first,
              password: "participant-password",
            })
          ).status,
          409,
        );
        assert.equal(
          (await user.login(first, "participant-password")).response.status,
          200,
        );
        assert.equal(
          (await other.login(second, "participant-password")).response.status,
          200,
        );
        assert.equal(
          (await anonymous.api("/data-portal/api/preferences")).status,
          401,
        );
        assert.equal((await user.api("/data-portal/api/users")).status, 403);
        assert.equal(
          (
            await mutation(user, "/data-portal/api/users", "POST", {
              user_id: "Unauthorized",
              password: "participant-password",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await mutation(user, "/data-portal/api/schedule", "PUT", {
              user_id: first,
              version: 0,
              sessions: [],
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await mutation(
              admin,
              "/data-portal/api/users",
              "DELETE",
              { user_id: second },
              { Origin: "https://untrusted.example" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "setup and dashboard preferences persist and remain scoped",
      async () => {
        const settings = await (
          await user.api("/data-portal/api/preferences")
        ).json();
        assert.deepEqual(settings.setup, DEFAULT_STUDY_SETUP);
        const setup = {
          ...DEFAULT_STUDY_SETUP,
          screenWidth: 50,
          xOffsetDeg: 7,
        };
        const saved = await mutation(
          user,
          "/data-portal/api/preferences",
          "PUT",
          { setup, dashboard_charts: ["accuracy"] },
        );
        assert.equal(saved.status, 200);
        assert.deepEqual((await saved.json()).setup, setup);
        assert.deepEqual(
          (await (await user.api("/data-portal/api/preferences")).json())
            .dashboard_charts,
          ["accuracy"],
        );
        assert.equal(
          (await user.api("/data-portal/api/preferences?user_id=" + second))
            .status,
          403,
        );
        assert.equal(
          (
            await mutation(user, "/data-portal/api/preferences", "PUT", {
              user_id: second,
              setup,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await mutation(user, "/data-portal/api/preferences", "PUT", {
              setup: { ...setup, resWidth: 0 },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await mutation(user, "/data-portal/api/preferences", "PUT", {
              dashboard_charts: ["difficulty"],
            })
          ).status,
          400,
        );
        assert.ok(studyCalibration(setup).xOffsetPx > 0);
      },
    );
    const row = {
      session_id: randomUUID(),
      starts_at: "2026-10-13T10:00:00-04:00",
      ends_at: "2026-10-13T10:30:00-04:00",
      session_type: "study",
      task_type: "Motion",
    };
    await t.test(
      "schedules synchronize; stale saves and foreign session IDs are rejected",
      async () => {
        const response = await mutation(
          admin,
          "/data-portal/api/schedule",
          "PUT",
          { user_id: first, version: 0, sessions: [row] },
        );
        assert.equal(response.status, 200);
        const synced = await (
          await user.api("/data-portal/api/schedule")
        ).json();
        assert.equal(synced.version, 1);
        assert.equal(synced.sessions[0].session_id, row.session_id);
        assert.equal(
          (await other.api("/data-portal/api/schedule?user_id=" + first))
            .status,
          403,
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/schedule", "PUT", {
              user_id: first,
              version: 0,
              sessions: [],
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/schedule", "PUT", {
              user_id: second,
              version: 0,
              sessions: [row],
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "one CSV round trips all users and invalid imports roll back atomically",
      async () => {
        const csv = await (
          await admin.api("/data-portal/api/schedule/export")
        ).text();
        assert.ok(parseScheduleCsv(csv).some((item) => item.user_id === first));
        assert.equal(
          (await user.api("/data-portal/api/schedule/export")).status,
          403,
        );
        const imported = {
          ...row,
          user_id: second,
          session_id: randomUUID(),
          session_type: "break",
        };
        const makeCsv = (records) =>
          SCHEDULE_COLUMNS.join(",") +
          "\n" +
          records
            .map((record) =>
              SCHEDULE_COLUMNS.map((key) => record[key]).join(","),
            )
            .join("\n");
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/schedule/import", "POST", {
              csv: makeCsv([imported]),
            })
          ).status,
          200,
        );
        assert.equal(
          (await (await other.api("/data-portal/api/schedule")).json())
            .sessions[0].session_type,
          "break",
        );
        const revised = { ...imported, task_type: "Centrality" };
        const invalid = { ...row, user_id: first, task_type: "Invalid" };
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/schedule/import", "POST", {
              csv: makeCsv([revised, invalid]),
            })
          ).status,
          400,
        );
        assert.equal(
          (await (await other.api("/data-portal/api/schedule")).json())
            .sessions[0].task_type,
          "Motion",
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/schedule/import", "POST", {
              csv: makeCsv([revised]),
            })
          ).status,
          200,
        );
        assert.equal(
          (await (await other.api("/data-portal/api/schedule")).json()).sessions
            .length,
          1,
        );
      },
    );
    await t.test(
      "account rename moves ownership and revokes sessions; deletion is not resurrected",
      async () => {
        await ingest(pool, {
          batch_id: randomUUID(),
          run,
          events: [
            {
              event_sequence: 1,
              included: true,
              payload: {
                user_id: first,
                task_type: "Motion",
                trial_index: 1,
                overall_trial_number: 1,
                correct: true,
                difficulty_level: 1,
                time_elapsed: 100,
              },
            },
          ],
        });
        const files = await (
          await admin.api(
            "/data-portal/api/files?user_id=" + first + "&metric_types=session",
          )
        ).json();
        assert.ok(files.files.every((file) => file.user_id === first));
        assert.equal(
          files.files.find((file) => file.reference === "run:" + run.id)
            .task_type,
          "Motion",
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/users", "PATCH", {
              original_user_id: first,
              user_id: renamed,
              password: "changed-password",
            })
          ).status,
          200,
        );
        assert.equal(
          (await user.api("/data-portal/api/preferences")).status,
          401,
        );
        assert.equal(
          (await user.login(renamed, "changed-password")).response.status,
          200,
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/users", "POST", {
              user_id: first,
              password: "participant-password",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await anonymous.post("/data-portal/auth/sign-up/email", {
              username: first,
              name: "Reserved ID",
              email: first + "@example.com",
              password: "participant-password",
              invitationCode: "bright",
            })
          ).status,
          400,
        );
        assert.equal(
          (await (await user.api("/data-portal/api/schedule")).json()).sessions
            .length,
          1,
        );
        assert.equal(
          (await (await user.api("/data-portal/api/preferences")).json()).setup
            .xOffsetDeg,
          7,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT user_id FROM experiment_data.runs WHERE id=$1",
              [run.id],
            )
          ).rows[0].user_id,
          first,
        );
        // An experiment already running with the original ID can still save.
        await ingest(pool, {
          batch_id: randomUUID(),
          run,
          events: [
            {
              event_sequence: 2,
              included: true,
              payload: {
                user_id: first,
                task_type: "Motion",
                trial_index: 2,
                overall_trial_number: 2,
                correct: false,
                difficulty_level: 1,
                time_elapsed: 200,
              },
            },
          ],
        });
        assert.equal(
          (
            await (
              await user.api("/data-portal/api/files?metric_types=session")
            ).json()
          ).files.find((file) => file.reference === "run:" + run.id).user_id,
          renamed,
        );
        assert.equal(
          (
            await mutation(admin, "/data-portal/api/users", "DELETE", {
              user_id: renamed,
            })
          ).status,
          200,
        );
        assert.equal(
          (await user.api("/data-portal/api/preferences")).status,
          401,
        );
        await migratePortalAccounts(pool, authOptions);
        assert.equal(
          (
            await pool.query(
              'SELECT id FROM portal_auth."user" WHERE username=ANY($1)',
              [[first, renamed]],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT id FROM experiment_data.runs WHERE id=$1",
              [run.id],
            )
          ).rowCount,
          1,
        );
      },
    );
  } finally {
    if (server) {
      server.close();
      await once(server, "close");
    }
    for (const table of ["ingest_batches", "events"])
      await pool.query(`DELETE FROM experiment_data.${table} WHERE run_id=$1`, [
        run.id,
      ]);
    await pool.query("DELETE FROM experiment_data.runs WHERE id=$1", [run.id]);
    await pool.query('DELETE FROM portal_auth."user" WHERE username=ANY($1)', [
      [first, second, renamed, adminId],
    ]);
    await pool.query(
      "DELETE FROM experiment_data.portal_retired_users WHERE user_id=ANY($1)",
      [[first, second, renamed]],
    );
    await pool.query(
      "DELETE FROM experiment_data.portal_user_aliases WHERE original_user_id=ANY($1)",
      [[first, second, renamed]],
    );
    await pool.end();
  }
});
