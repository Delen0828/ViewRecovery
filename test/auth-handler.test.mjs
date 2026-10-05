import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthHandler,normalizeUsername} from '../supabase/functions/_shared/auth-handler.js';
import {safeReturnPath,taskFromPath} from '../src/auth/routes.js';
const request=body=>new Request('http://localhost:5173/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:JSON.stringify(body)});
const defaults={redirectUrl:'http://localhost:5173/auth/callback',salt:'a'.repeat(64),trustedIp:()=> 'fixture-peer'};
function fixture({email='fixture@example.invalid',limit=true,authError=null,reserveError=null}={}) {
 const calls=[];
 const auth={
  async signInWithPassword(input) {calls.push(['password',input]);return {data:{session:authError?null:{access_token:'fixture-token',refresh_token:'fixture-refresh'}},error:authError};},
  async signUp(input){calls.push(['register',input]);return {data:{},error:authError};},
  async resetPasswordForEmail(input,options){calls.push(['recover',input,options]);return {error:authError};}
 };
 const admin={async rpc(name,args){calls.push([name,args]);return name==='consume_auth_limit'?{data:limit,error:null}:name==='reserve_username'?{data:'fixture-reservation',error:reserveError}:{data:email,error:null};}};
 return {calls,handler:createAuthHandler({...defaults,admin,publicClientFactory:()=>({auth})})};
}
test('username normalization and return routes cannot grant roles or redirect offsite',()=>{
 assert.deepEqual(normalizeUsername('  Test_User  '),{label:'Test_User',normalized:'test_user'});
 for(const value of ['ab','a space','../admin','administrator!']) assert.throws(()=>normalizeUsername(value));
 for(const value of ['https://evil.test','//evil.test','/\\evil.test','/%2f%2fevil.test','/save_data.php','/auth/callback','/anything']) assert.equal(safeReturnPath(value,'http://localhost:5173'),'/dashboard');
 assert.equal(safeReturnPath('/Motion?study=fixture','http://localhost:5173'),'/Motion?study=fixture');
 assert.equal(taskFromPath('/mOtIoN/'),'Motion');assert.equal(taskFromPath('/Motion/admin'),null);
});
test('unknown usernames prompt registration, bad passwords are generic, valid login returns a session',async()=>{
 let f=fixture({email:null});let res=await f.handler(request({action:'login',username:'unknown',password:'wrong'}));
 assert.equal(res.status,404);assert.equal((await res.json()).code,'USERNAME_NOT_REGISTERED');assert.ok(!f.calls.some(c=>c[0]==='password'));
 f=fixture({authError:{message:'private diagnostic'}});res=await f.handler(request({action:'login',username:'fixture',password:'wrong'}));
 assert.equal(res.status,401);assert.ok(!(await res.text()).includes('private diagnostic'));
 f=fixture();res=await f.handler(request({action:'login',username:' FIXTURE ',password:'secret'}));
 assert.equal(res.status,200);const data=await res.json();assert.ok(data.session);assert.ok(!data.email);
 assert.equal(f.calls.find(c=>c[0]==='username_auth_email')[1].username,'fixture');
 assert.equal(f.calls.filter(c=>c[0]==='consume_auth_limit').length,2);
 assert.ok(f.calls.filter(c=>c[0]==='consume_auth_limit').every(c=>/^[0-9a-f]{64}$/.test(c[1].key_hash)));
});
test('registration reserves usernames and never passes role/link/study authority from submitted fields',async()=>{
 const f=fixture();const res=await f.handler(request({action:'register',username:'Test_User',email:'fixture@example.invalid',password:'LongPassword!123',role:'admin',participant_id:'victim',study_id:'restricted'}));
 assert.equal(res.status,200);
 const input=f.calls.find(c=>c[0]==='register')[1];
 assert.deepEqual(input.options.data,{username:'Test_User',username_reservation:'fixture-reservation'});
 assert.equal(input.options.emailRedirectTo,defaults.redirectUrl);
 const g=fixture({reserveError:{code:'23505'}});
 assert.equal((await g.handler(request({action:'register',username:'fixture',email:'fixture@example.invalid',password:'LongPassword!123'}))).status,409);
 assert.ok(!g.calls.some(c=>c[0]==='register'));
});
test('limits, request sizes, origins, methods and recovery responses are enforced',async()=>{
 const f=fixture({limit:false});assert.equal((await f.handler(request({action:'login',username:'fixture',password:'secret'}))).status,429);
 assert.ok(!f.calls.some(c=>c[0]==='username_auth_email'));
 const g=fixture();assert.equal((await g.handler(new Request('http://localhost:5173/api/auth',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}))).status,403);
 assert.equal((await g.handler(new Request('http://localhost:5173/api/auth'))).status,405);
 assert.equal((await g.handler(request({action:'login',username:'fixture',password:'x'.repeat(9000)}))).status,413);
 const h=fixture({authError:{message:'email does not exist'}});
 const res=await h.handler(request({action:'recover',email:'fixture@example.invalid'}));
 assert.equal(res.status,200);assert.ok(!(await res.text()).includes('does not exist'));
 assert.ok(!h.calls.some(c=>c[0]==='username_auth_email'));
});
