import {openDatabase, stopPostgres} from './lib/postgres.mjs';
if (process.argv[2] === 'stop') {
  stopPostgres();
  console.log('Local PostgreSQL stopped. Data remains in .runtime/pgdata.');
} else {
  const pool = await openDatabase();
  console.log('PostgreSQL ready; experiment_data schema is installed.');
  await pool.end();
}
