import fs from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {readLocalEnv,validateStagingEnv} from './lib/local-env.mjs';
const env=readLocalEnv();
if(validateStagingEnv(env).length || !env.SUPABASE_ACCESS_TOKEN) {console.error('Staging configuration or access token missing');process.exit(1);}
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const secretsFile='env/edge-staging.env';
fs.writeFileSync(secretsFile,`AUTH_RATE_LIMIT_SALT=${env.AUTH_RATE_LIMIT_SALT}\nAUTH_REDIRECT_URL=${env.AUTH_REDIRECT_URL}\n`,{mode:0o600});
const report={checks:[],passed:false};
async function cli(args,label) {
 const result=await new Promise(resolve=>{
  let output='';
  const child=spawn('node_modules/.bin/supabase',args,{env:{...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH,SUPABASE_ACCESS_TOKEN:env.SUPABASE_ACCESS_TOKEN}});
  child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
  child.on('error',()=>resolve({status:1}));child.on('close',status=>resolve({status}));
 });
 report.checks.push({name:label,passed:result.status===0});
 console.log(`${result.status===0?'PASS':'FAIL'} ${label} (CLI output omitted to protect configuration)`);
 if(result.status!==0) throw new Error('Deployment step failed');
}
try {
 await cli(['secrets','set','--env-file',secretsFile,'--project-ref',ref],'Staging auth secrets');
 await cli(['functions','deploy','username-auth','--project-ref',ref,'--use-api','--no-verify-jwt'],'Staging username-auth deployment');
 report.passed=true;
} catch {process.exitCode=1;} finally {
 fs.rmSync(secretsFile,{force:true});
 fs.writeFileSync('test/results/step-03-deployment.json',JSON.stringify(report,null,2)+'\n');
}
