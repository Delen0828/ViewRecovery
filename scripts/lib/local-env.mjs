import fs from 'node:fs';
export function readLocalEnv(path='env/staging.env') {
  const result={};
  for(const [index,line] of fs.readFileSync(path,'utf8').split(/\r?\n/).entries()) {
    const text=line.trim();
    if(!text || text.startsWith('#')) continue;
    const match=text.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if(!match) throw new Error(`Invalid environment syntax at line ${index+1}`);
    let value=match[2].trim();
    if(value.startsWith('"') || value.startsWith("'")) {
      if(value.at(-1)!==value[0]) throw new Error(`Unclosed environment quote at line ${index+1}`);
      value=value.slice(1,-1);
    }
    if(Object.hasOwn(result,match[1])) throw new Error(`Duplicate environment variable ${match[1]}`);
    result[match[1]]=value;
  }
  return result;
}
export function validateStagingEnv(env) {
  const failures=[];
  for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','AUTH_RATE_LIMIT_SALT','AUTH_REDIRECT_URL']) {
    if(!env[key]) failures.push(`${key} is empty`);
  }
  if(!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) failures.push('Server API key is empty');
  for(const [a,b] of [['SUPABASE_URL','VITE_SUPABASE_URL'],['SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_PUBLISHABLE_KEY']]) {
    if(env[a]!==env[b]) failures.push(`${a} and ${b} differ`);
  }
  try {
    const url=new URL(env.SUPABASE_URL);
    if(url.protocol!=='https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.search || url.hash || url.pathname!=='/') failures.push('Invalid SUPABASE_URL');
  } catch { failures.push('Invalid SUPABASE_URL'); }
  try {
    const url=new URL(env.DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.hostname || url.pathname!=='/postgres' || url.hash) failures.push('DATABASE_URL requires a full PostgreSQL URI with username, encoded password, host and /postgres');
    if(url.port==='6543') failures.push('DATABASE_URL uses a transaction pooler; use Direct or Session pooler');
  } catch { failures.push('DATABASE_URL requires a full PostgreSQL URI'); }
  if((env.AUTH_RATE_LIMIT_SALT?.length??0)<32) failures.push('AUTH_RATE_LIMIT_SALT must have at least 32 characters');
  for(const key of Object.keys(env).filter(k=>k.startsWith('VITE_'))) {
    if(!['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY'].includes(key)) failures.push(`Unexpected public variable ${key}`);
    if(env[key]?.startsWith('sb_secret_')) failures.push(`${key} must not contain a secret key`);
  }
  return failures;
}
