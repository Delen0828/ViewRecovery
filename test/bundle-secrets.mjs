import fs from 'node:fs';
import path from 'node:path';
import {readLocalEnv} from '../scripts/lib/local-env.mjs';
const env=readLocalEnv();
const secrets=Object.entries(env).filter(([name,value])=>value&&!['VITE_SUPABASE_URL','SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','SUPABASE_PUBLISHABLE_KEY','AUTH_REDIRECT_URL','STUDY_ID','DATA_PORTAL_USER'].includes(name));
let count=0;
function scan(dir) {
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())scan(file);
  else {
   const content=fs.readFileSync(file);count++;
   if(secrets.some(([,value])=>content.includes(Buffer.from(value)))) throw new Error('Server secret found in build output');
  }
 }
}
try {scan('dist');fs.writeFileSync('test/results/step-03-bundle-secrets.json',JSON.stringify({passed:true,files_checked:count,secret_values_logged:false},null,2)+'\n');console.log(`PASS server-secret exclusion (${count} built files checked)`);}
catch {fs.writeFileSync('test/results/step-03-bundle-secrets.json',JSON.stringify({passed:false,secret_values_logged:false},null,2)+'\n');console.error('FAIL server-secret exclusion (values omitted)');process.exitCode=1;}
