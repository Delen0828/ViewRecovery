import './account.css';
import {supabase,requireClient} from './services/supabase.js';
import {getVerifiedSession,logout} from './services/auth.js';
import {loadDashboard} from './services/dashboard.js';
import {safeReturnPath,authPath,taskFromPath} from './auth/routes.js';
import {renderAuth,escapeHtml} from './auth/ui.js';
import {accountAccess} from './services/portal.js';
import {renderAdmin,renderArtifacts} from './portal.js';
const root=document.getElementById('app')||document.getElementById('portal');
let generation=0;
async function start() {
 const current=++generation;
 const url=new URL(location.href),returnPath=safeReturnPath(url.searchParams.get('returnTo')||'/dashboard',location.origin);
 if(url.pathname==='/admin/login') {location.replace(authPath('login','/admin'));return;}
 const authRoute=url.pathname.startsWith('/auth/');
 root.innerHTML='<section class="account-card"><p role="status">Loading your account…</p></section>';
 if(!supabase) throw new Error('Supabase configuration is missing for this environment.');
 const session=await getVerifiedSession();
 if(current!==generation) return;
 if(authRoute) {
   const mode=url.pathname.split('/')[2]||'login';
   if(mode==='change') {
     if(!session) {location.replace(authPath('login'));return;}
     const {data,error}=await requireClient().from('profiles').select('display_username').eq('auth_user_id',session.user.id).single();
     if(error) throw new Error('Could not load your account.');
     renderAuth(root,{mode:'change',returnPath:'/dashboard',username:data.display_username});return;
   }
   const recovery=new URLSearchParams(url.hash.slice(1)).get('type')==='recovery'||sessionStorage.getItem('viewrecovery-recovery')==='1';
   if(mode==='callback') {
     if(recovery && session) {sessionStorage.setItem('viewrecovery-recovery','1');renderAuth(root,{mode:'reset',returnPath,recovery:true});return;}
     if(session) {location.replace(returnPath);return;}
     renderAuth(root,{mode:'login',returnPath});
     root.querySelector('#auth-status').textContent='Email verification completed? Sign in with your username and password.';
     return;
   }
   if(session && !recovery && !['recover','reset'].includes(mode)) {location.replace(returnPath);return;}
   renderAuth(root,{mode:['login','register','recover','reset'].includes(mode)?mode:'login',returnPath,username:url.searchParams.get('username')||'',recovery:recovery&&Boolean(session)});
   return;
 }
 if(!session || sessionStorage.getItem('viewrecovery-recovery')==='1') {
  location.replace(authPath('login',safeReturnPath(url.pathname+url.search,location.origin)));return;
 }
 const task=taskFromPath(url.pathname);
 const pageValue=Number(url.searchParams.get('page')||0);
 const page=Number.isInteger(pageValue)&&pageValue>=0&&pageValue<=1000000?pageValue:0;
 const dashboard=await loadDashboard(session.user.id,page);
 const access=await accountAccess();
 if(current!==generation) return;
 const portal=url.pathname.startsWith('/data-portal');
 if(url.pathname==='/admin' || (portal && access==='admin')) {
  if(access!=='admin') {root.innerHTML='<section class="account-card"><h1>Administrator access required</h1><a href="/dashboard">Back to dashboard</a></section>';return;}
  await renderAdmin(root,url,dashboard.profile);
 } else {
 root.innerHTML=`<main class="account-shell"><header><strong>${escapeHtml(dashboard.profile.display_username)}</strong><nav><a href="/dashboard">Dashboard</a><a href="/data-portal/">Study results</a>${access==='admin'?'<a href="/admin">All users</a>':''}<a href="/auth/change">Change password</a><button id="sign-out">Sign out</button></nav></header>
 <h1>${task?`${escapeHtml(task)} setup`:portal?'Study results':'Your dashboard'}</h1>
 <p id="dashboard-status" role="status"></p>
 <section class="account-card"><h2>Studies</h2>${dashboard.studies.length?`<ul>${dashboard.studies.map(s=>`<li>${escapeHtml(s.name)} — ${s.active?'Active':'Not active'}</li>`).join('')}</ul>`:'<p>Your account is ready. Study staff must enroll you before task setup.</p>'}</section>
 ${!portal?`<section class="account-card"><h2>Training setup</h2><p>Starting a task requires confirmed display measurements, task positions, and an approved enrollment.</p><p>Task setup is not available yet. Contact study staff for enrollment and setup availability.</p><div class="task-links">${['Motion','Orientation','Centrality','Bar'].map(t=>`<a href="/${t}">${t} setup</a>`).join('')}</div></section>`:''}
 <section class="account-card"><h2>Authorized runs</h2><p>Showing up to 25 of ${dashboard.totalRuns} runs in your account or assigned study scope.</p>
 ${dashboard.runs.length?`<table><thead><tr><th>Task</th><th>Started</th><th>Status</th></tr></thead><tbody>${dashboard.runs.map(r=>`<tr><td>${escapeHtml(r.task)}</td><td>${escapeHtml(new Date(r.started_at).toLocaleString('en-US',{timeZone:'America/New_York'}))}</td><td>${escapeHtml(r.status)}</td></tr>`).join('')}</tbody></table>`:'<p>No authorized runs are available.</p>'}
 ${dashboard.totalRuns>25?`<nav aria-label="Run pages">${page>0?`<a href="${escapeHtml(url.pathname)}?page=${page-1}">Previous runs</a>`:''}${(page+1)*25<dashboard.totalRuns?`<a href="${escapeHtml(url.pathname)}?page=${page+1}">Next runs</a>`:''}</nav>`:''}
 </section><section id="historical-files" class="account-card"></section></main>`;
 await renderArtifacts(root.querySelector('#historical-files'),url,dashboard.participant?.id);
 }
}
// Available immediately when a dashboard is drawn, even while files load.
root.addEventListener('click',async event=>{
 const button=event.target.closest?.('#sign-out');
 if(!button || button.disabled)return;
 button.disabled=true;
 try {await logout();sessionStorage.removeItem('viewrecovery-recovery');location.replace(authPath());}
 catch(error){const status=root.querySelector('#dashboard-status');if(status)status.textContent=error.message;button.disabled=false;}
});
// Register synchronously; avoid awaiting other Auth methods inside the Auth callback.
supabase?.auth.onAuthStateChange((event)=>{
 if(event==='PASSWORD_RECOVERY') sessionStorage.setItem('viewrecovery-recovery','1');
 if(event==='SIGNED_OUT' && !location.pathname.startsWith('/auth/')) {generation++;location.replace(authPath('login',safeReturnPath(location.pathname+location.search,location.origin)));}
});
start().catch(error=>{root.innerHTML=`<section class="account-card"><h1>Account unavailable</h1><p role="alert">${escapeHtml(error.message)}</p><a href="${escapeHtml(authPath())}">Sign in</a></section>`;});
