import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readLocalEnv,validateStagingEnv} from '../scripts/lib/local-env.mjs';
const env={SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',DATABASE_URL:'postgresql://postgres:p%40ss@db.fixture.supabase.co:5432/postgres',AUTH_RATE_LIMIT_SALT:'a'.repeat(64),AUTH_REDIRECT_URL:'http://localhost:5173/auth/callback'};
test('valid staging config supports new server secret keys and rejects partial database credentials',()=>{
  assert.deepEqual(validateStagingEnv(env),[]);
  for(const value of ['password-only','db.fixture.supabase.co','postgresql://postgres@db.fixture.supabase.co:5432/postgres']) {
    assert.ok(validateStagingEnv({...env,DATABASE_URL:value}).some(e=>e.startsWith('DATABASE_URL')));
  }
  assert.ok(validateStagingEnv({...env,DATABASE_URL:'postgresql://postgres:password@db.fixture.supabase.co:6543/postgres'}).some(e=>e.includes('transaction pooler')));
});
test('configuration rejects exposed secrets and mismatched client keys',()=>{
  assert.ok(validateStagingEnv({...env,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do_not_expose'}).some(e=>e.includes('secret key')));
  assert.ok(validateStagingEnv({...env,VITE_DATABASE_URL:env.DATABASE_URL}).some(e=>e.includes('Unexpected public')));
  assert.ok(validateStagingEnv({...env,VITE_SUPABASE_URL:'https://other.supabase.co'}).some(e=>e.includes('differ')));
});
test('local env parser reads quotes without evaluating shell expressions',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'viewrecovery-env-'));
  try {
    const file=path.join(dir,'fixture.env');
    fs.writeFileSync(file,"# fixture\nVALUE='literal$(no_command)'\nOTHER=\"a=b\"\nEMPTY=\n");
    assert.deepEqual(readLocalEnv(file),{VALUE:'literal$(no_command)',OTHER:'a=b',EMPTY:''});
    fs.writeFileSync(file,'KEY=x\nKEY=y'); assert.throws(()=>readLocalEnv(file),/Duplicate/);
    fs.writeFileSync(file,'KEY="unclosed'); assert.throws(()=>readLocalEnv(file),/Unclosed/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
