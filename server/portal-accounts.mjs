import {randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';

const DEFAULT_ADMIN_HASH = '$2y$12$QcA4yw1pW53AmQw.bZDL0OhXkrWFAKZy5OWjj4Ghf.N5Q2BAdfgr6';
const legacyEmail = (role, username) => `${Buffer.from(`${role}:${username}`).toString('hex')}@portal.invalid`;

// Re-running adds missing accounts/passwords without resetting any credential,
// role, or participant ownership that already exists.
export async function migratePortalAccounts(pool, options = {}) {
  const adminUsername = options.adminUsername ?? (process.env.DATA_PORTAL_USER || 'admin');
  const adminPasswordHash = options.adminPasswordHash ?? (process.env.DATA_PORTAL_PASS_HASH || DEFAULT_ADMIN_HASH);
  const participantPasswordHash = options.participantPasswordHash ?? (process.env.DATA_PORTAL_PARTICIPANT_PASS_HASH || '');
  const client = await pool.connect();
  const report = {users_created: 0, admins_created: 0, passwords_created: 0};
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('viewrecovery-portal-accounts-v1'))");
    const participants = await client.query(`SELECT DISTINCT user_id FROM (
      SELECT user_id FROM experiment_data.portal_files
      UNION SELECT user_id FROM experiment_data.portal_sessions WHERE role='user'
      UNION SELECT username FROM portal_auth."user" WHERE role='user'
    ) owners WHERE user_id ~ '^[A-Za-z0-9]{1,32}$' ORDER BY user_id`);
    const accounts = [{username: adminUsername, role: 'admin', passwordHash: adminPasswordHash},
      ...participants.rows.filter(row => row.user_id !== adminUsername).map(row => ({username: row.user_id, role: 'user', passwordHash: participantPasswordHash}))];
    for (const account of accounts) {
      const existing = await client.query('SELECT id, role FROM portal_auth."user" WHERE username=$1', [account.username]);
      if (existing.rowCount && existing.rows[0].role !== account.role) throw new Error(`Portal account role conflict for ${account.username}.`);
      const id = existing.rows[0]?.id || randomUUID();
      if (!existing.rowCount) {
        await client.query(`INSERT INTO portal_auth."user" (id,name,email,"emailVerified",username,role,"participantId","createdAt","updatedAt")
          VALUES($1,$2,$3,false,$4,$5,$6,now(),now())`,
        [id, account.role === 'admin' ? 'Admin' : `User ${account.username}`, legacyEmail(account.role, account.username), account.username, account.role, account.role === 'user' ? account.username : '']);
        report[account.role === 'admin' ? 'admins_created' : 'users_created']++;
      }
      const credential = await client.query('SELECT id,password FROM portal_auth.account WHERE "userId"=$1 AND "providerId"=\'credential\'', [id]);
      if (!credential.rows[0]?.password) {
        const password = account.passwordHash || await hashPassword(account.username);
        if (credential.rowCount) {
          await client.query('UPDATE portal_auth.account SET password=$1,"updatedAt"=now() WHERE id=$2', [password, credential.rows[0].id]);
        } else {
          await client.query(`INSERT INTO portal_auth.account (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
            VALUES($1,$2,'credential',$2,$3,now(),now())`, [randomUUID(), id, password]);
        }
        report.passwords_created++;
      }
    }
    // Legacy sessions cannot become authenticated Better Auth sessions.
    await client.query('DELETE FROM experiment_data.portal_sessions');
    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
