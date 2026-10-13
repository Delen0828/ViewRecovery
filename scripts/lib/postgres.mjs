import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(process.env.EXPERIMENT_RUNTIME_DIR || join(projectRoot, '.runtime'));
const cluster = join(runtime, 'pgdata');
const socket = join(runtime, 'pgsocket');

function binaries() {
  const candidates = [process.env.PG_BIN, join(runtime, 'postgres/usr/lib/postgresql/18/bin')];
  if (existsSync('/usr/lib/postgresql')) {
    for (const v of readdirSync('/usr/lib/postgresql').sort((a, b) => Number(b) - Number(a))) {
      candidates.push(`/usr/lib/postgresql/${v}/bin`);
    }
  }
  for (const bin of candidates.filter(Boolean)) {
    if (existsSync(join(bin, 'initdb')) && existsSync(join(bin, 'pg_ctl'))) return bin;
  }
  try { return dirname(execFileSync('which', ['initdb'], {encoding: 'utf8'}).trim()); }
  catch { throw new Error('PostgreSQL binaries are missing. Install PostgreSQL, set PG_BIN, run scripts/setup-postgres-ubuntu.sh, or set DATABASE_URL to an existing PostgreSQL server.'); }
}

function localConfig() {
  mkdirSync(runtime, {recursive: true, mode: 0o700});
  const passwordFile = join(runtime, 'postgres.password');
  if (!existsSync(passwordFile)) writeFileSync(passwordFile, randomBytes(32).toString('hex'), {mode: 0o600});
  const password = readFileSync(passwordFile, 'utf8').trim();
  const port = Number(process.env.EXPERIMENT_PG_PORT || 55432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid EXPERIMENT_PG_PORT');
  return {passwordFile, password, port, host: '127.0.0.1', user: 'viewrecovery', database: 'viewrecovery'};
}

function run(bin, command, args, options = {}) {
  const lib = join(runtime, 'postgres/usr/lib/x86_64-linux-gnu');
  return execFileSync(join(bin, command), args, {
    env: {...process.env, LD_LIBRARY_PATH: [lib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},
    encoding: 'utf8', ...options
  });
}

export async function startPostgres() {
  if (process.env.DATABASE_URL) return {connectionString: process.env.DATABASE_URL};
  const config = localConfig();
  const bin = binaries();
  mkdirSync(socket, {recursive: true, mode: 0o700});
  if (!existsSync(join(cluster, 'PG_VERSION'))) {
    const args = ['-D', cluster, '--username=viewrecovery', `--pwfile=${config.passwordFile}`,
      '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C.UTF-8'];
    const share = resolve(bin, '../../../../share/postgresql', basenameVersion(bin));
    if (existsSync(share)) args.push('-L', share);
    run(bin, 'initdb', args);
  }
  let running = false;
  try { run(bin, 'pg_ctl', ['-D', cluster, 'status'], {stdio: 'pipe'}); running = true; } catch {}
  if (!running) {
    // PostgreSQL parses its -o string itself; quote paths with spaces explicitly.
    const quotedSocket = '"' + socket.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    run(bin, 'pg_ctl', ['-D', cluster, '-l', join(runtime, 'postgres.log'), '-w', '-t', '30',
      '-o', `-h 127.0.0.1 -p ${config.port} -k ${quotedSocket}`, 'start']);
  }
  const admin = new pg.Client({...config, database: 'postgres'});
  await admin.connect();
  try {
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'viewrecovery'");
    if (!result.rowCount) await admin.query('CREATE DATABASE viewrecovery');
  } finally { await admin.end(); }
  return {host: config.host, port: config.port, user: config.user, password: config.password, database: config.database};
}

function basenameVersion(bin) { return bin.split('/').at(-2); }

export function stopPostgres() {
  if (process.env.DATABASE_URL) throw new Error('db:stop only stops the project-managed local cluster.');
  run(binaries(), 'pg_ctl', ['-D', cluster, '-w', '-t', '30', '-m', 'fast', 'stop']);
}

export async function openDatabase() {
  const pool = new pg.Pool({...await startPostgres(), max: 5});
  pool.on('error', error => console.error('[PostgreSQL]', error.message));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('viewrecovery-schema-v1'))");
    await client.query(readFileSync(join(projectRoot, 'sql/001-experiment.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return pool;
}
