import {randomBytes, timingSafeEqual} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {hash, fail} from './store.mjs';

const COOKIE = 'viewrecovery_portal_session';
// Retain the legacy PHP portal's default hash and environment overrides.
const DEFAULT_ADMIN_HASH = '$2y$12$QcA4yw1pW53AmQw.bZDL0OhXkrWFAKZy5OWjj4Ghf.N5Q2BAdfgr6';
const random = () => randomBytes(32).toString('hex');
function same(a, b) {
  const left=Buffer.from(String(a)),right=Buffer.from(String(b));
  return left.length===right.length && timingSafeEqual(left,right);
}
function integer(value, fallback) {
  const n=Number(value);
  return Number.isSafeInteger(n) && n>0 ? n : fallback;
}

export function createPortalAuth(pool, options={}) {
  const adminUsername=options.adminUsername ?? (process.env.DATA_PORTAL_USER || 'admin');
  const adminPasswordHash=options.adminPasswordHash ?? (process.env.DATA_PORTAL_PASS_HASH || DEFAULT_ADMIN_HASH);
  const participantPasswordHash=options.participantPasswordHash ?? (process.env.DATA_PORTAL_PARTICIPANT_PASS_HASH || '');
  const ttl=integer(process.env.DATA_PORTAL_SESSION_TTL_SEC,86400);
  const maxAttempts=integer(process.env.DATA_PORTAL_MAX_ATTEMPTS,5);
  const windowMs=integer(process.env.DATA_PORTAL_ATTEMPT_WINDOW_SEC,900)*1000;
  const attempts=new Map();

  function setCookie(request,response,id,maxAge=ttl) {
    const secure=request.socket.encrypted || request.headers['x-forwarded-proto']?.split(',')[0].trim()==='https';
    response.setHeader('Set-Cookie',`${COOKIE}=${id}; Path=/data-portal; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  async function insertSession(role='anonymous',user_id='') {
    const id=random(),csrf_token=random();
    await pool.query(`INSERT INTO experiment_data.portal_sessions(id_hash,csrf_token,role,user_id,expires_at)
      VALUES($1,$2,$3,$4,now()+$5*interval '1 second')`,[hash(id),csrf_token,role,user_id,ttl]);
    return {id_hash:hash(id),csrf_token,role,user_id,id};
  }
  async function session(request,response) {
    const id=request.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    await pool.query('DELETE FROM experiment_data.portal_sessions WHERE expires_at<=now()');
    if (id && /^[a-f0-9]{64}$/.test(id)) {
      const found=await pool.query('SELECT id_hash,csrf_token,role,user_id FROM experiment_data.portal_sessions WHERE id_hash=$1 AND expires_at>now()',[hash(id)]);
      if (found.rowCount) return found.rows[0];
    }
    const fresh=await insertSession();setCookie(request,response,fresh.id);return fresh;
  }
  function state(session) {
    const authenticated=session.role!=='anonymous';
    return {authenticated,csrf_token:session.csrf_token,login_error:'',role:authenticated ? session.role : '',
      user_id:session.user_id,user_label:session.role==='admin' ? 'Admin' : authenticated ? `User ${session.user_id}` : ''};
  }
  function csrf(session,form) {
    if (!same(session.csrf_token,form.csrf_token || '')) fail('Invalid CSRF token.',403);
  }
  async function login(request,response,session,form) {
    csrf(session,form);
    const ip=request.socket.remoteAddress;
    const now=Date.now();
    for (const [key,values] of attempts) {
      const fresh=values.filter(time=>now-time<windowMs);
      if (fresh.length) attempts.set(key,fresh); else attempts.delete(key);
    }
    const failures=attempts.get(ip) || [];
    if (failures.length>=maxAttempts) fail('Too many failed login attempts. Retry later.',429);
    const username=String(form.username || '').trim(),password=String(form.password || '');
    if (password.length>4096) fail('Password is too long.');
    const isAdmin=same(username,adminUsername);
    const adminValid=isAdmin && await bcrypt.compare(password,adminPasswordHash);
    const participantValid=!isAdmin && /^[A-Za-z0-9]{1,32}$/.test(username) &&
      (!participantPasswordHash || await bcrypt.compare(password,participantPasswordHash));
    if (!adminValid && !participantValid) {
      attempts.set(ip,[...failures,now]);fail('Invalid username or password.',401);
    }
    const next=await insertSession(adminValid ? 'admin' : 'user',adminValid ? '' : username);
    await pool.query('DELETE FROM experiment_data.portal_sessions WHERE id_hash=$1',[session.id_hash]);
    attempts.delete(ip);setCookie(request,response,next.id);
    return {success:true,redirect:'/data-portal/users.html',...state(next)};
  }
  async function logout(request,response,session,form) {
    csrf(session,form);
    await pool.query('DELETE FROM experiment_data.portal_sessions WHERE id_hash=$1',[session.id_hash]);
    setCookie(request,response,'',0);
    return {success:true,redirect:'/data-portal/users.html'};
  }
  return {session,state,login,logout};
}
