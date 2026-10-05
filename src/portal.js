import {requireClient} from './services/supabase.js';
import {userDirectory,listArtifacts,artifactUrl,artifactCsv} from './services/portal.js';
import {parseCsv} from './portal-csv.js';
import {escapeHtml as e} from './auth/ui.js';
function pageNumber(value) {const n=Number(value||0);return Number.isInteger(n)&&n>=0&&n<=10000?n:0;}
function pages(url,page,total,size,key) {
 const link=(n,label)=>{const u=new URL(url);u.searchParams.set(key,n);return `<a href="${e(u.pathname+u.search)}">${label}</a>`;};
 return `<nav>${page>0?link(page-1,'Previous'):''}${(page+1)*size<total?link(page+1,'Next'):''}</nav>`;
}
export async function renderArtifacts(container,url,participantId=null,unassigned=false) {
 const page=pageNumber(url.searchParams.get('filePage'));
 const result=await listArtifacts({participantId,page,unassigned});
 container.innerHTML=`<h2>Historical files</h2><p>${result.total} preserved files. Source rows can overlap between final, chunk and backup files.</p>
 <div class="table-scroll"><table><thead><tr><th>File</th><th>Task</th><th>Source rows</th><th>Identity</th><th>Actions</th></tr></thead><tbody>
 ${result.files.map((file,i)=>`<tr><td>${e(file.original_path)}</td><td>${e(file.task||'—')}</td><td>${e(file.row_count??'—')}</td><td>${e(file.identity_status||'—')}</td><td><button data-download="${i}">Download</button> ${['.csv','.bak'].includes(file.kind)?`<button data-preview="${i}">View rows</button>`:''}</td></tr>`).join('')}
 </tbody></table></div>${pages(url,page,result.total,25,'filePage')}<p role="status" id="file-status"></p><div id="file-preview"></div>`;
 const status=container.querySelector('#file-status');
 for(const button of container.querySelectorAll('[data-download]')) button.addEventListener('click',async()=>{
  button.disabled=true;
  try {
   const file=result.files[Number(button.dataset.download)];
   const link=document.createElement('a');link.href=await artifactUrl(file);link.download=file.original_path.split('/').at(-1);link.target='_blank';link.rel='noopener';link.click();
  } catch(error){status.textContent=error.message;} finally{button.disabled=false;}
 });
 let previewGeneration=0;
 for(const button of container.querySelectorAll('[data-preview]')) button.addEventListener('click',async()=>{
  const current=++previewGeneration;button.disabled=true;status.textContent='Loading preserved rows…';
  try {
   const file=result.files[Number(button.dataset.preview)];const csv=parseCsv(await artifactCsv(file));
   if(current!==previewGeneration)return;
   let rowPage=0;
   const render=()=>{
    const preview=container.querySelector('#file-preview');
    preview.innerHTML=`<h3>${e(file.original_path)}</h3><p>${csv.rows.length} source rows; showing ${rowPage*50+1}–${Math.min((rowPage+1)*50,csv.rows.length)}.</p>
    <div class="table-scroll"><table><thead><tr><th>Source row</th>${csv.header.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${csv.rows.slice(rowPage*50,rowPage*50+50).map((row,i)=>`<tr><td>${rowPage*50+i+1}</td>${row.map(cell=>`<td><span class="raw-cell">${e(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <nav>${rowPage?'<button id="previous-rows">Previous rows</button>':''}${(rowPage+1)*50<csv.rows.length?'<button id="next-rows">Next rows</button>':''}</nav>`;
    preview.querySelector('#previous-rows')?.addEventListener('click',()=>{rowPage--;render();});
    preview.querySelector('#next-rows')?.addEventListener('click',()=>{rowPage++;render();});
   };
   render();status.textContent='Original file checksum verified.';
  } catch(error){if(current===previewGeneration)status.textContent=error.message;} finally{button.disabled=false;}
 });
}
export async function renderAdmin(root,url,profile) {
 const page=pageNumber(url.searchParams.get('page')),search=(url.searchParams.get('search')||'').slice(0,32);
 const directory=await userDirectory(search,page);
 const selected=url.searchParams.get('user');
 root.innerHTML=`<main class="account-shell"><header><strong>${e(profile.display_username)} — Administrator</strong><nav><a href="/dashboard">Dashboard</a><a href="/admin">All users</a><a href="/admin?files=all">All files</a><a href="/admin?files=unassigned">Unassigned files</a><a href="/auth/change">Change password</a><button id="sign-out">Sign out</button></nav></header>
 <h1>Admin — all user data</h1><section class="account-card"><form method="get" action="/admin"><label>Find user<input name="search" value="${e(search)}" maxlength="32"></label><button>Search</button></form>
 <p>${directory.total} user accounts. File and row totals describe preserved source records.</p><div class="table-scroll"><table><thead><tr><th>User</th><th>Account</th><th>Files</th><th>Source rows</th><th>Runs</th><th>Last run</th></tr></thead><tbody>
 ${directory.users.map(user=>`<tr><td><a href="/admin?user=${e(user.participant_id)}">${e(user.username)}</a></td><td>${e(user.provenance)}</td><td>${e(user.file_count)}</td><td>${e(user.source_rows)}</td><td>${e(user.run_count)}</td><td>${e(user.last_run_at||'—')}</td></tr>`).join('')}
 </tbody></table></div>${pages(url,page,directory.total,50,'page')}</section><section id="user-details" class="account-card" hidden></section><section id="historical-files" class="account-card"></section><p role="status" id="dashboard-status"></p></main>`;
 if(selected) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected)) throw new Error('Invalid user selection.');
  const client=requireClient();
  const {data:participant,error}=await client.from('participants').select('auth_user_id').eq('id',selected).single();
  if(error || !participant) throw new Error('User not found.');
  const results=await Promise.all([
   client.from('profiles').select('display_username,preferences').eq('auth_user_id',participant.auth_user_id).single(),
   client.from('display_profiles').select('name,settings,version,confirmed_at').eq('auth_user_id',participant.auth_user_id),
   client.from('training_settings').select('task,settings,version,confirmed_at').eq('participant_id',selected),
   client.from('experiment_runs').select('id,task,status,started_at,ended_at,parameter_snapshot',{count:'exact'}).eq('participant_id',selected).order('started_at',{ascending:false}).range(pageNumber(url.searchParams.get('runPage'))*25,pageNumber(url.searchParams.get('runPage'))*25+24)
  ]);
  if(results.some(r=>r.error))throw new Error('Could not read user details.');
  const box=root.querySelector('#user-details');box.hidden=false;
  const runPage=pageNumber(url.searchParams.get('runPage'));
  box.innerHTML=`<h2>${e(results[0].data.display_username)}</h2><details><summary>Preferences and settings</summary><pre>${e(JSON.stringify({preferences:results[0].data.preferences,display:results[1].data,training:results[2].data},null,2))}</pre></details><h3>Recorded runs (${results[3].count||0})</h3>${results[3].data.map(run=>`<details><summary>${e(run.task)} — ${e(run.status)} — ${e(run.started_at)}</summary><pre>${e(JSON.stringify(run,null,2))}</pre><button data-run="${e(run.id)}">View events</button><div class="run-events"></div></details>`).join('')}${pages(url,runPage,results[3].count||0,25,'runPage')}`;
  for(const button of box.querySelectorAll('[data-run]'))button.addEventListener('click',async()=>{
   button.disabled=true;let eventPage=0;
   const target=button.nextElementSibling;
   const load=async()=>{
    const {data,error,count}=await client.from('experiment_events').select('client_sequence,phase,payload,created_at',{count:'exact'}).eq('run_id',button.dataset.run).order('client_sequence').range(eventPage*50,eventPage*50+49);
    if(error){target.textContent='Could not load events.';return;}
    target.innerHTML=`<pre>${e(JSON.stringify(data,null,2))}</pre><nav>${eventPage?'<button data-prev>Previous events</button>':''}${(eventPage+1)*50<count?'<button data-next>Next events</button>':''}</nav>`;
    target.querySelector('[data-prev]')?.addEventListener('click',()=>{eventPage--;load();});
    target.querySelector('[data-next]')?.addEventListener('click',()=>{eventPage++;load();});
   };
   try {await load();} catch{target.textContent='Could not load events.';} finally{button.disabled=false;}
  });
 }
 await renderArtifacts(root.querySelector('#historical-files'),url,selected,url.searchParams.get('files')==='unassigned');
}
