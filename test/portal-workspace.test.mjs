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
  validateScheduleRows,
} from "../server/portal-workspace.mjs";
import { DEFAULT_STUDY_SETUP, studyCalibration } from "../src/study-setup.js";
import { ingest } from "../server/store.mjs";

test("schedule rows validate timestamps and conflicts", () => {
  const row = {
    session_id: randomUUID(),
    user_id: "P1",
    starts_at: "2026-11-01T01:00:00-04:00",
    ends_at: "2026-11-01T01:30:00-05:00",
    session_type: "study",
    task_type: "Motion",
  };
  assert.equal(
    Date.parse(validateScheduleRows([row], "P1")[0].ends_at) -
      Date.parse(validateScheduleRows([row], "P1")[0].starts_at),
    90 * 60000,
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
        assert.deepEqual(settings.dashboard_stats, ["sessions", "trials", "average_study_time"]);
        const setup = {
          ...DEFAULT_STUDY_SETUP,
          screenWidth: 50,
          xOffsetDeg: 7,
        };
        const saved = await mutation(
          user,
          "/data-portal/api/preferences",
          "PUT",
          { setup, dashboard_charts: ["accuracy"], dashboard_stats: ["average_accuracy", "total_study_time"] },
        );
        assert.equal(saved.status, 200);
        assert.deepEqual((await saved.json()).setup, setup);
        assert.deepEqual(
          (await (await user.api("/data-portal/api/preferences")).json())
            .dashboard_charts,
          ["accuracy"],
        );
        assert.deepEqual(
          (await (await user.api("/data-portal/api/preferences")).json()).dashboard_stats,
          ["average_accuracy", "total_study_time"],
        );
        assert.deepEqual(
          (await (await other.api("/data-portal/api/preferences")).json()).dashboard_stats,
          ["sessions", "trials", "average_study_time"],
        );
        for (const dashboard_stats of [[], ["unknown"], ["sessions", "sessions"], "sessions",
          ["sessions", "trials", "average_study_time", "average_accuracy", "total_study_time"]]) {
          assert.equal((await mutation(user, "/data-portal/api/preferences", "PUT", { dashboard_stats })).status, 400);
        }
        assert.equal((await mutation(user, "/data-portal/api/preferences", "PUT", {
          user_id: second, dashboard_stats: ["trials"],
        })).status, 403);
        assert.equal((await mutation(admin, "/data-portal/api/preferences", "PUT", {
          user_id: second, dashboard_stats: ["sessions", "trials", "average_study_time", "average_accuracy"],
        })).status, 200);
        assert.deepEqual((await (await other.api("/data-portal/api/preferences")).json()).dashboard_stats,
          ["sessions", "trials", "average_study_time", "average_accuracy"]);
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
      "daily definitions persist, expand for participants, and appear in the admin-only overview",
      async () => {
        const recurring = {
          session_id: randomUUID(), start_date: "2026-10-31", end_date: "2026-11-02",
          scheduled_time: "10:15", duration_minutes: 45, session_type: "study", task_type: "Orientation",
        };
        const response = await mutation(admin, "/data-portal/api/schedule", "PUT", {
          user_id: second, version: 0, sessions: [recurring],
        });
        assert.equal(response.status, 200);
        const saved = await response.json();
        assert.equal(saved.sessions.length, 1);
        assert.equal(saved.sessions[0].end_date, "2026-11-02");
        assert.equal(saved.sessions[0].duration_minutes, 45);
        assert.equal((await (await admin.api("/data-portal/api/schedule?user_id=" + second)).json()).sessions[0].start_date, "2026-10-31");
        const participantSchedule = await (await other.api("/data-portal/api/schedule")).json();
        assert.equal(participantSchedule.sessions.length, 3);
        assert.equal(participantSchedule.sessions[1].starts_at, "2026-11-01T15:15:00.000Z");
        const overview = await (await admin.api("/data-portal/api/schedule/overview")).json();
        assert.ok(overview.sessions.some((item) => item.user_id === first));
        assert.ok(overview.sessions.some((item) => item.user_id === second));
        assert.equal((await user.api("/data-portal/api/schedule/overview")).status, 403);
        assert.equal((await other.api("/data-portal/api/schedule/overview?user_id=" + second)).status, 403);
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
        const retainedUsers = await (await admin.api("/data-portal/api/users")).json();
        assert.equal(retainedUsers.users.find((entry) => entry.user_id === renamed).has_account, false);
        // Delete the data-only user directly, including data linked to its original ID.
        assert.equal((await mutation(admin, "/data-portal/api/users", "DELETE", {
          user_id: renamed, delete_data: "true",
        })).status, 400);
        await ingest(pool, {
          batch_id: randomUUID(), run,
          events: [],
          save: { save_key: "final_complete_user_" + first + ".json", prefix: "final_complete", overwrite: false, rows: [{ user_id: first }] },
        });
        const job = (await pool.query(
          "INSERT INTO experiment_data.import_jobs(archive_sha256,archive_name) VALUES($1,'delete-data-test.zip') RETURNING id",
          [randomUUID()],
        )).rows[0].id;
        try {
          for (const owner of [first, second]) {
            const source = (await pool.query(
              `INSERT INTO experiment_data.source_files(import_job_id,original_path,sha256,kind,user_id,row_count,bytes)
               VALUES($1,$2,$3,'csv',NULL,1,$4) RETURNING id`,
              [job, `final_complete_user_${owner}_Motion.csv`, randomUUID(), Buffer.from("user_id\n" + owner)],
            )).rows[0].id;
            await pool.query("INSERT INTO experiment_data.source_rows(source_file_id,ordinal,payload) VALUES($1,1,$2)", [source, { user_id: owner }]);
          }
          await pool.query("SELECT experiment_data.ensure_portal_metrics(array_agg(reference)) FROM experiment_data.portal_files WHERE user_id=$1", [renamed]);
          const refs = (await pool.query("SELECT reference FROM experiment_data.portal_files WHERE user_id=$1", [renamed])).rows.map((row) => row.reference);
          assert.equal(refs.length, 3);
          assert.equal((await mutation(user, "/data-portal/api/users", "DELETE", {
            user_id: renamed, delete_data: true,
          })).status, 401);
          assert.equal((await mutation(admin, "/data-portal/api/users", "DELETE", {
            user_id: renamed,
          })).status, 200);
          assert.equal((await pool.query("SELECT reference FROM experiment_data.portal_files WHERE user_id=$1", [renamed])).rowCount, 0);
          assert.equal((await pool.query("SELECT reference FROM experiment_data.portal_metrics WHERE reference=ANY($1)", [refs])).rowCount, 0);
          assert.equal((await pool.query("SELECT id FROM experiment_data.runs WHERE id=$1", [run.id])).rowCount, 0);
          assert.equal((await pool.query("SELECT batch_id FROM experiment_data.ingest_batches WHERE run_id=$1", [run.id])).rowCount, 0);
          assert.equal((await pool.query("SELECT * FROM experiment_data.source_rows WHERE source_file_id IN (SELECT id FROM experiment_data.source_files WHERE import_job_id=$1)", [job])).rowCount, 1);
          const deletedUsers = await (await admin.api("/data-portal/api/users")).json();
          assert.ok(!deletedUsers.users.some((entry) => entry.user_id === renamed || entry.user_id === first));
          assert.ok(deletedUsers.users.some((entry) => entry.user_id === second && entry.has_account));
          // Imported IDs need not follow the newer account-creation format.
          const legacyId = `Legacy-${suffix}`;
          const legacySource = (await pool.query(
            `INSERT INTO experiment_data.source_files(import_job_id,original_path,sha256,kind,user_id,row_count,bytes)
             VALUES($1,$2,$3,'csv',$4,1,$5) RETURNING id`,
            [job, `final_complete_user_${legacyId}_Motion.csv`, randomUUID(), legacyId, Buffer.from("legacy data")],
          )).rows[0].id;
          await pool.query("INSERT INTO experiment_data.source_rows(source_file_id,ordinal,payload) VALUES($1,1,$2)", [legacySource, { user_id: legacyId }]);
          const legacyUsers = await (await admin.api("/data-portal/api/users")).json();
          assert.equal(legacyUsers.users.find((entry) => entry.user_id === legacyId).has_account, false);
          assert.equal((await mutation(admin, "/data-portal/api/users", "DELETE", {
            user_id: legacyId,
          })).status, 200);
          assert.equal((await pool.query("SELECT id FROM experiment_data.source_files WHERE id=$1", [legacySource])).rowCount, 0);
          assert.equal((await pool.query("SELECT ordinal FROM experiment_data.source_rows WHERE source_file_id=$1", [legacySource])).rowCount, 0);
          assert.equal((await mutation(admin, "/data-portal/api/users", "DELETE", {
            user_id: renamed,
          })).status, 404);
          await migratePortalAccounts(pool, authOptions);
          assert.equal((await pool.query('SELECT id FROM portal_auth."user" WHERE username=ANY($1)', [[first, renamed]])).rowCount, 0);
        } finally {
          await pool.query("DELETE FROM experiment_data.source_rows WHERE source_file_id IN (SELECT id FROM experiment_data.source_files WHERE import_job_id=$1)", [job]);
          await pool.query("DELETE FROM experiment_data.source_files WHERE import_job_id=$1", [job]);
          await pool.query("DELETE FROM experiment_data.import_jobs WHERE id=$1", [job]);
        }
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
