import fs from 'node:fs';
import {readLocalEnv} from './lib/local-env.mjs';
const env=readLocalEnv();
const report={checks:[]};
async function main() {
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 const base=new URL(env.SUPABASE_URL);
 if(base.protocol!=='https:' || !base.hostname.endsWith('.supabase.co') || !key) throw new Error('Invalid staging configuration');
 const headers={apikey:key,'Content-Type':'application/json',...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})};
 for(const name of ['legacy-archive','exports']) {
   let res=await fetch(new URL(`/storage/v1/bucket/${name}`,base),{headers,signal:AbortSignal.timeout(15000)});
   if(res.status===404 || res.status===400) {
     res=await fetch(new URL('/storage/v1/bucket',base),{method:'POST',headers,body:JSON.stringify({id:name,name,public:false}),signal:AbortSignal.timeout(15000)});
     if(!res.ok) throw new Error(`Private bucket creation failed (HTTP ${res.status})`);
   } else if(!res.ok) throw new Error(`Private bucket inspection failed (HTTP ${res.status})`);
   res=await fetch(new URL(`/storage/v1/bucket/${name}`,base),{headers,signal:AbortSignal.timeout(15000)});
   if(!res.ok || (await res.json()).public!==false) throw new Error('Bucket privacy verification failed');
   report.checks.push({name:`Private bucket ${name}`,passed:true});
   console.log(`PASS private bucket ${name}`);
 }
}
try {await main();report.passed=true;} catch(e) {report.passed=false;console.error('FAIL bucket provisioning: '+(e.message?.startsWith('Private bucket')?e.message:'check configuration and project permissions')+' (credentials omitted)');process.exitCode=1;}
fs.writeFileSync('test/results/staging-buckets.json',JSON.stringify(report,null,2)+'\n');
