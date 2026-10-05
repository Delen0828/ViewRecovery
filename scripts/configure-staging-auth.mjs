import fs from 'node:fs';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
const env=readLocalEnv(),report={checks:[],passed:false};
if(validateStagingEnv(env).length || !env.SUPABASE_ACCESS_TOKEN) {console.error('Staging configuration/access token missing');process.exit(1);}
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const endpoint=`https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers={Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'};
try {
 let res=await fetch(endpoint,{headers,signal:AbortSignal.timeout(15000)});
 if(!res.ok) throw new Error();
 const current=await res.json(),allowed=new Set((current.uri_allow_list||'').split(',').map(s=>s.trim()).filter(Boolean));
 allowed.add(env.AUTH_REDIRECT_URL);
 const desired={site_url:new URL(env.AUTH_REDIRECT_URL).origin,uri_allow_list:Array.from(allowed).join(','),password_min_length:Math.max(current.password_min_length||0,12)};
 if(Object.keys(desired).some(key=>current[key]!==desired[key])) {
  res=await fetch(endpoint,{method:'PATCH',headers,body:JSON.stringify(desired),signal:AbortSignal.timeout(15000)});
  if(!res.ok) throw new Error();
 }
 res=await fetch(endpoint,{headers,signal:AbortSignal.timeout(15000)});
 if(!res.ok) throw new Error();
 const actual=await res.json();
 for(const [name,passed] of [
  ['Staging site URL',actual.site_url===desired.site_url],
  ['Exact Auth callback allowed',(actual.uri_allow_list||'').split(',').includes(env.AUTH_REDIRECT_URL)],
  ['Auth password minimum enforced',actual.password_min_length>=12],
  ['Email confirmation required',actual.mailer_autoconfirm===false]
 ]) {report.checks.push({name,passed});console.log(`${passed?'PASS':'FAIL'} ${name}`);}
 report.passed=report.checks.every(c=>c.passed);if(!report.passed)process.exitCode=1;
} catch {console.error('FAIL staging Auth configuration (credentials and configuration bodies omitted)');process.exitCode=1;}
fs.writeFileSync('test/results/step-03-auth-configuration.json',JSON.stringify(report,null,2)+'\n');
