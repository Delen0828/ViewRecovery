import './account.css';
import {supabase} from './services/supabase.js';
import {getVerifiedSession,logout} from './services/auth.js';
import {loadDashboard} from './services/dashboard.js';
import {safeReturnPath,authPath,taskFromPath} from './auth/routes.js';
import {renderAuth,escapeHtml} from './auth/ui.js';
import {renderAdmin,renderArtifacts} from './portal.js';
import {renderOverview,renderRecordedRun,renderRunHistory} from './portal-results.js';
import {accountShell} from './account-layout.js';
import {renderTraining} from './training-settings.js';
import {pendingRuns,createRunSync} from './experiment/sync.js';
const root=document.getElementById('app')||document.getElementById('portal');
let generation=0;
async function start() {
 const current=++generation;
 const url=new URL(location.href),returnPath=safeReturnPath(url.searchParams.get('returnTo')||'/dashboard',location.origin);
 if(url.pathname==='/admin/login'){location.replace(authPath('login','/admin'));return;}
 const accountPage=['/account','/auth/change'].includes(url.pathname);
 const authRoute=url.pathname.startsWith('/auth/')&&!accountPage;
 root.innerHTML='<section class="account-card"><p role="status">Loading your account…</p></section>';
 if(!supabase)throw new Error('Supabase configuration is missing for this environment.');
 const session=await getVerifiedSession();if(current!==generation)return;
 if(authRoute) {
  const mode=url.pathname.split('/')[2]||'login';
  const recovery=new URLSearchParams(url.hash.slice(1)).get('type')==='recovery'||sessionStorage.getItem('viewrecovery-recovery')==='1';
  if(mode==='callback') {
   if(recovery&&session){sessionStorage.setItem('viewrecovery-recovery','1');renderAuth(root,{mode:'reset',returnPath,recovery:true});return;}
   if(session){location.replace(returnPath);return;}
   renderAuth(root,{mode:'login',returnPath});root.querySelector('#auth-status').textContent='Email verification completed? Sign in with your username and password.';return;
  }
  if(session&&!recovery&&!['recover','reset'].includes(mode)){location.replace(returnPath);return;}
  renderAuth(root,{mode:['login','register','recover','reset'].includes(mode)?mode:'login',returnPath,username:url.searchParams.get('username')||'',recovery:recovery&&Boolean(session)});return;
 }
 if(!session||sessionStorage.getItem('viewrecovery-recovery')==='1') {
  location.replace(authPath('login',safeReturnPath(accountPage?'/account':url.pathname+url.search,location.origin)));return;
 }
 const task=taskFromPath(url.pathname);
 const pageValue=Number(url.searchParams.get('page')||0),runPage=Number.isInteger(pageValue)&&pageValue>=0&&pageValue<=1000000?pageValue:0;
 const dashboard=await loadDashboard(session.user.id,runPage);if(current!==generation)return;
 const access=dashboard.access;
 if(url.pathname==='/admin'&&access!=='admin'){root.innerHTML='<section class="account-card"><h1>Administrator access required</h1><a href="/dashboard">My progress</a></section>';return;}
 const preview=url.pathname.endsWith('/preview.html')&&(url.searchParams.has('file')||url.searchParams.has('run'));
 const files=access==='admin'&&((url.pathname.startsWith('/data-portal')&&!url.pathname.endsWith('/users.html')&&!preview)||(url.pathname==='/admin'&&url.searchParams.has('files')));
 const page=accountPage?'account':preview?'preview':url.pathname==='/settings'||task?'settings':files?'files':'progress';
 if(page==='account') {
  root.innerHTML=accountShell(dashboard.profile,access,page,url.searchParams.get('user'));
  renderAuth(root.querySelector('#page-content'),{mode:'change',returnPath:'/dashboard',username:dashboard.profile.display_username,embedded:true});
 } else if(access==='admin') {
  await renderAdmin(root,url,dashboard,session.user.id,page,task||'Motion');
 } else {
  root.innerHTML=accountShell(dashboard.profile,access,page);
  const content=root.querySelector('#page-content');
  if(page==='settings')await renderTraining(content,dashboard,session.user.id,task||'Motion');
  else if(page==='preview') {
   if(url.searchParams.has('run'))await renderRecordedRun(content,url.searchParams.get('run'));
   else await renderArtifacts(content,url,dashboard.participant?.id);
  } else if(dashboard.participant) {
   await renderOverview(content,dashboard.participant.id,{singleUser:true,username:dashboard.profile.display_username});renderRunHistory(content,dashboard,url);
  } else content.innerHTML='<p>Your account is ready. Study staff must enroll you before training.</p>';
 }
 if(['progress','settings'].includes(page))renderPending(session.user.id);
}
function renderPending(ownerId) {
 const pending=pendingRuns(ownerId);if(!pending.length)return;
 const box=document.createElement('section');box.className='account-card';
 box.innerHTML=`<h2>Pending synchronization</h2><p>${pending.length} runs have data saved in this browser. Keep this browser storage until synchronization succeeds.</p><button id="retry-pending">Retry pending uploads</button><p role="status"></p>`;
 root.querySelector('.account-shell').appendChild(box);
 box.querySelector('button').addEventListener('click',async()=>{
  const button=box.querySelector('button'),status=box.querySelector('[role="status"]');button.disabled=true;
  try{for(const run of pending)await createRunSync(run,ownerId).flush();status.textContent='Pending events synchronized. Unfinished runs remain available in your recorded history.';}
  catch(error){status.textContent=error.message;}finally{button.disabled=false;}
 });
}
root.addEventListener('click',async event=>{
 const button=event.target.closest?.('#sign-out');if(!button||button.disabled)return;
 button.disabled=true;
 try{await logout();sessionStorage.removeItem('viewrecovery-recovery');location.replace(authPath());}
 catch(error){const status=root.querySelector('#dashboard-status');if(status)status.textContent=error.message;button.disabled=false;}
});
supabase?.auth.onAuthStateChange(event=>{
 if(event==='PASSWORD_RECOVERY')sessionStorage.setItem('viewrecovery-recovery','1');
 if(event==='SIGNED_OUT'&&!location.pathname.startsWith('/auth/')){generation++;location.replace(authPath('login',safeReturnPath(location.pathname+location.search,location.origin)));}
});
start().catch(error=>{root.innerHTML=`<section class="account-card"><h1>Account unavailable</h1><p role="alert">${escapeHtml(error.message)}</p><a href="${escapeHtml(authPath())}">Sign in</a></section>`;});
