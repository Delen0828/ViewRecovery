import {randomBytes} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {isIP} from 'node:net';
import {betterAuth} from 'better-auth';
import {APIError, createAuthMiddleware} from 'better-auth/api';
import {hashPassword, verifyPassword} from 'better-auth/crypto';
import {fromNodeHeaders, toNodeHandler} from 'better-auth/node';
import {username} from 'better-auth/plugins';
import {PostgresDialect} from 'kysely';
import bcrypt from 'bcryptjs';
import {projectRoot} from '../scripts/lib/postgres.mjs';
import {migratePortalAccounts} from './portal-accounts.mjs';
import {fail} from './store.mjs';

export const AUTH_PATH = '/data-portal/auth';

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function clientIP(request, trustedProxies) {
  const normalize = value => String(value || '').trim().replace(/^::ffff:/, '');
  const peer = normalize(request.socket.remoteAddress);
  if (!trustedProxies.includes(peer)) return peer;
  const cloudflare = normalize(request.headers['cf-connecting-ip']);
  if (isIP(cloudflare)) return cloudflare;
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map(normalize);
  for (const address of forwarded.reverse()) {
    if (!isIP(address)) return peer;
    if (!trustedProxies.includes(address)) return address;
  }
  return peer;
}

function authSecret(options) {
  const configured = options.secret || process.env.BETTER_AUTH_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
    return configured;
  }
  const runtime = resolve(process.env.EXPERIMENT_RUNTIME_DIR || join(projectRoot, '.runtime'));
  mkdirSync(runtime, {recursive: true, mode: 0o700});
  const file = join(runtime, 'portal-auth.secret');
  try { writeFileSync(file, randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o600}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readFileSync(file, 'utf8').trim();
}

export function createPortalAuth(pool, options = {}) {
  const trustedProxies = (process.env.DATA_PORTAL_TRUSTED_PROXIES ?? '127.0.0.1,::1').split(',').map(value => value.trim()).filter(Boolean);
  const baseURL = options.baseURL || process.env.BETTER_AUTH_URL || {
    allowedHosts: ['localhost:*', '127.0.0.1:*'],
    fallback: `http://127.0.0.1:${process.env.PORT || 8000}`
  };
  const auth = betterAuth({
    appName: 'ViewRecovery Data Portal',
    baseURL,
    basePath: AUTH_PATH,
    secret: authSecret(options),
    database: {dialect: new PostgresDialect({pool}), type: 'postgres', schemaName: 'portal_auth', transaction: true},
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        // Legacy PHP/Node bcrypt accounts keep their existing passwords.
        verify: ({hash, password}) => /^\$2[aby]\$/.test(hash)
          ? bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2b$'))
          : verifyPassword({hash, password})
      }
    },
    emailVerification: {sendOnSignUp: false, sendOnSignIn: false},
    socialProviders: {},
    disabledPaths: ['/sign-in/email', '/sign-in/social', '/is-username-available'],
    user: {
      additionalFields: {
        role: {type: 'string', required: true, defaultValue: 'user', input: false},
        participantId: {type: 'string', required: true, defaultValue: '', input: false}
      }
    },
    session: {
      expiresIn: positiveInteger(process.env.DATA_PORTAL_SESSION_TTL_SEC, 86400),
      cookieCache: {enabled: false}
    },
    plugins: [username({
      minUsernameLength: 1,
      maxUsernameLength: 128,
      usernameNormalization: false,
      usernameValidator: value => /^[A-Za-z0-9_.-]+$/.test(value),
      displayUsername: false,
      immutableUsername: true
    })],
    advanced: {
      database: {generateId: 'uuid'},
      cookiePrefix: 'viewrecovery',
      defaultCookieAttributes: {path: '/data-portal', httpOnly: true, sameSite: 'lax'},
      ipAddress: {ipAddressHeaders: ['x-portal-client-ip']}
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/username': {window: positiveInteger(process.env.DATA_PORTAL_ATTEMPT_WINDOW_SEC, 900), max: positiveInteger(options.maxAttempts ?? process.env.DATA_PORTAL_MAX_ATTEMPTS, 5)},
        '/sign-up/email': {window: 900, max: positiveInteger(options.maxAttempts, 5)}
      }
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === '/sign-up/email') {
          if (ctx.body?.invitationCode !== 'bright') throw new APIError('FORBIDDEN', {message: 'Invalid invitation code.'});
          if (!/^[A-Za-z0-9]{1,32}$/.test(ctx.body?.username || '')) throw new APIError('BAD_REQUEST', {message: 'User ID must contain 1–32 letters or numbers.'});
          const alias = await pool.query('SELECT original_user_id FROM experiment_data.portal_user_aliases WHERE original_user_id=$1 AND current_user_id<>$1', [ctx.body.username]);
          if (alias.rowCount) throw new APIError('BAD_REQUEST', {message: 'This user ID has been renamed and is reserved.'});
          if (ctx.body.role !== undefined && ctx.body.role !== 'user') throw new APIError('FORBIDDEN', {message: 'Sign-up is only available for users.'});
          if (ctx.body.mode !== undefined && ctx.body.mode !== 'user') throw new APIError('FORBIDDEN', {message: 'Sign-up is only available for users.'});
        }
        if (ctx.path === '/sign-in/username') {
          const mode = ctx.body?.mode;
          if (!['user', 'admin'].includes(mode)) throw new APIError('BAD_REQUEST', {message: 'Select user or admin login mode.'});
          ctx.context.portalLoginMode = mode;
        }
      })
    },
    databaseHooks: {
      user: {create: {before: async user => ({data: {...user, role: 'user', participantId: user.username}})}},
      session: {create: {before: async (session, ctx) => {
        if (ctx?.path === '/sign-in/username') {
          const account = await pool.query('SELECT role FROM portal_auth."user" WHERE id=$1', [session.userId]);
          if (account.rows[0]?.role !== ctx.context.portalLoginMode) throw new APIError('UNAUTHORIZED', {message: 'Invalid username or password for the selected login mode.'});
        }
      }}}
    }
  });
  const ready = migratePortalAccounts(pool, options);
  // The server reports a migration error on startup/requests, never as an unhandled rejection.
  ready.catch(() => {});
  const nodeHandler = toNodeHandler(auth);
  async function handler(request, response) {
    await ready;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // Also protect first login: the username plugin only checks Origin when
      // a cookie is already present. JSON-only requests prevent form fallback.
      const origins = typeof baseURL === 'string' ? [new URL(baseURL).origin]
        : [`http://${request.headers.host}`, `https://${request.headers.host}`];
      if (!origins.includes(request.headers.origin)) fail('Origin is not allowed.', 403);
      if (!request.headers['content-type']?.startsWith('application/json')) fail('Expected JSON.', 415);
    }
    request.headers['x-portal-client-ip'] = clientIP(request, trustedProxies);
    return nodeHandler(request, response);
  }
  async function session(request, response) {
    await ready;
    const result = await auth.api.getSession({headers: fromNodeHeaders(request.headers), returnHeaders: true});
    const cookies = result.headers?.getSetCookie();
    if (cookies?.length) response.setHeader('Set-Cookie', cookies);
    const found = result.response;
    if (!found) return {role: 'anonymous', user_id: ''};
    return {role: found.user.role, user_id: found.user.participantId};
  }
  function state(session) {
    const authenticated = ['admin', 'user'].includes(session.role);
    return {authenticated, login_error: '', role: authenticated ? session.role : '', user_id: session.user_id,
      user_label: session.role === 'admin' ? 'Admin' : authenticated ? `User ${session.user_id}` : ''};
  }
  return {handler, session, state, ready};
}
