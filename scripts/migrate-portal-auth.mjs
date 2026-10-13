import {openDatabase} from './lib/postgres.mjs';
import {migratePortalAccounts} from '../server/portal-accounts.mjs';

const pool = await openDatabase();
try { console.log(JSON.stringify(await migratePortalAccounts(pool), null, 2)); }
finally { await pool.end(); }
