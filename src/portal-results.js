import {escapeHtml as e} from './auth/ui.js';
import {artifactManifest,artifactData,artifactUrl,sessionSummaries,recordedRun} from './services/portal.js';
import {TASKS,COLORS,fileType,fileDate,dateKey,dateLabel,duration,percent} from './portal-metrics.js';
import {chart,bindCharts} from './portal-charts.js';

const metric=(label,value)=>`<div class="metric"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
const bytes=n=>n<1024?`${n||0} B`:`${(n/1024/(n>=1048576?1024:1)).toFixed(1)} ${n>=1048576?'MB':'KB'}`;
export function rowsCsv(rows) {
 const header=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const cell=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
 const data=rows.map(row=>header.map(key=>cell(row[key])));
 const quote=value=>`"${value.replaceAll('"','""')}"`;
 return {header,rows:data,text:[header,...data].map(row=>row.map(quote).join(',')).join('\r\n')};
}
export async function renderRecordedRun(container,id) {
 container.innerHTML='<h2>Recorded run preview</h2><p role="status">Loading recorded events…</p>';
 try {
  const {run,rows,metrics}=await recordedRun(id),csv=rowsCsv(rows);
  container.innerHTML=`<h2>Recorded run preview</h2><p>${e(run.task)} · ${e(run.status)} · ${e(dateLabel(run.started_at))}</p><button id="export-run">Download CSV</button><details><summary>Confirmed training parameters</summary><pre>${e(JSON.stringify(run.parameter_snapshot,null,2))}</pre></details><div id="recorded-preview"></div>`;
  renderPreview(container.querySelector('#recorded-preview'),{original_path:`${run.task} run ${run.id}`},csv,metrics);
  container.querySelector('#export-run').addEventListener('click',()=>{
   const url=URL.createObjectURL(new Blob([csv.text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`run_${run.task}_${run.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
 }catch(error){container.innerHTML=`<h2>Recorded run preview</h2><p role="alert">${e(error.message)}</p>`;}
}
function durationStack(m) {
 const ratio=m.totalMs?m.trainingMs/m.totalMs*100:0;
 return `<div class="duration-stack" title="Training ${duration(m.trainingMs)}; resting ${duration(m.restingMs)}"><strong>${duration(m.totalMs)}</strong><div class="duration-bar"><span style="width:${ratio}%"></span></div><small>${duration(m.trainingMs)} training + ${duration(m.restingMs)} rest</small></div>`;
}
function summary(m) {return `<div class="metrics">${metric('Responses',m.total)}${metric('Accuracy',percent(m.correct,m.total))}${metric('Training',duration(m.trainingMs))}${metric('Resting',duration(m.restingMs))}${metric('Catch test',`${percent(m.catchCorrect,m.catchTotal)} (${m.catchCorrect}/${m.catchTotal})`)}</div>`;}
export function renderPreview(container,file,csv,metrics) {
 let page=0;const size=50;
 container.innerHTML=`<h3>${e(file.original_path)}</h3>${metrics?summary(metrics)+chart('Accuracy by difficulty',TASKS.map(task=>({name:task,values:metrics.levels.filter(g=>g.task===task).map(g=>({x:g.level,y:g.accuracy,detail:`${g.correct}/${g.total} correct`}))})),{xLabel:'Difficulty level'}):'<p role="status">Session metrics are unavailable.</p>'}<h3>Source rows</h3><div id="preview-rows"></div>`;
 const render=()=>{
  const box=container.querySelector('#preview-rows');
  box.innerHTML=`<p>${csv.rows.length} source rows; showing ${csv.rows.length?page*size+1:0}–${Math.min((page+1)*size,csv.rows.length)}.</p><div class="table-scroll"><table><thead><tr><th>Source row</th>${csv.header.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${csv.rows.slice(page*size,page*size+size).map((row,i)=>`<tr><td>${page*size+i+1}</td>${row.map(cell=>`<td><span class="raw-cell">${e(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div><nav>${page?'<button data-prev>Previous rows</button>':''}${(page+1)*size<csv.rows.length?'<button data-next>Next rows</button>':''}</nav>`;
  box.querySelector('[data-prev]')?.addEventListener('click',()=>{page--;render();});
  box.querySelector('[data-next]')?.addEventListener('click',()=>{page++;render();});
 };
 render();bindCharts(container);
}
export async function renderArtifacts(container,url,participantId=null,unassigned=false) {
 container.innerHTML='<h2>File download</h2><p role="status">Loading file overview…</p>';
 const files=await artifactManifest(participantId,unassigned);
 const explicit=url.searchParams.get('file');
 if(explicit && url.pathname.endsWith('/preview.html')) {
  container.innerHTML='<h2>File preview</h2><a href="/data-portal/">Back to file overview</a><p role="status" id="file-status">Loading preserved rows…</p><div id="file-preview"></div>';
  const status=container.querySelector('#file-status'),file=files.find(f=>f.id===explicit||f.original_path===explicit);
  try {
   if(!file)throw new Error('The selected file is unavailable or outside your account access.');
   const {csv,metrics}=await artifactData(file);
   renderPreview(container.querySelector('#file-preview'),file,csv,metrics);status.textContent='Original file checksum verified.';
   const button=document.createElement('button');button.textContent='Download original';
   button.addEventListener('click',async()=>{button.disabled=true;try{const a=document.createElement('a');a.href=await artifactUrl(file,true);a.download=file.original_path.split('/').at(-1);a.click();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
   container.insertBefore(button,status);
  }catch(error){status.textContent=error.message;}
  return;
 }
 container.innerHTML=`<div class="section-heading"><div><h2>Historical files</h2><p class="note">Preserved originals. Final files are shown by default.</p></div><a href="/dashboard${participantId?'?user='+e(participantId):''}">View progress</a></div>
 <form class="filters" id="file-filters"><label>Filename search<input name="q" value="${e(url.searchParams.get('q')||'')}" placeholder="Search files"></label><label>Created from<input name="from" type="date" value="${e(url.searchParams.get('from')||'')}"></label><label>Created to<input name="to" type="date" value="${e(url.searchParams.get('to')||'')}"></label><button type="submit">Refresh</button><div class="filter-toggles">${['session','pause','other'].map(type=>`<label class="check"><input type="checkbox" name="${type}" ${url.searchParams.get(type)==='1'?'checked':''}>${type==='other'?'Other files and backups':type==='session'?'Session files':'Pause files'}</label>`).join('')}</div></form><div id="file-summary" class="metrics"></div><div class="table-scroll"><table><thead><tr><th>File / task</th><th>Duration</th><th>Size</th><th>Created (Eastern)</th><th>Test pass rate</th><th>Actions</th></tr></thead><tbody id="file-rows"></tbody></table></div><nav id="file-pages"></nav><p role="status" id="file-status"></p><div id="file-preview"></div>`;
 const form=container.querySelector('#file-filters'),status=container.querySelector('#file-status');
 let page=0,generation=0,previewGeneration=0;
 async function draw() {
  const current=++generation,filter=new FormData(form);
  const visible=files.filter(f=>{
   const type=fileType(f),key=dateKey(fileDate(f));
   return (type==='final'||filter.has(type)) && (!filter.get('q')||f.original_path.toLowerCase().includes(String(filter.get('q')).toLowerCase())) && (!filter.get('from')||key>=filter.get('from')) && (!filter.get('to')||key<=filter.get('to'));
  }).sort((a,b)=>String(fileDate(b)).localeCompare(String(fileDate(a)))||a.original_path.localeCompare(b.original_path));
  page=Math.min(page,Math.max(0,Math.ceil(visible.length/25)-1));
  const currentFiles=visible.slice(page*25,page*25+25);
  container.querySelector('#file-summary').innerHTML=metric('Files',visible.length)+metric('Total size',bytes(visible.reduce((n,f)=>n+(f.bytes||0),0)))+metric('Newest file',dateLabel(fileDate(visible[0]||{})));
  container.querySelector('#file-rows').innerHTML=currentFiles.map((f,i)=>`<tr><td><span class="file-name">${e(f.original_path)}</span><small>${e(f.task||'Other')} · ${e(f.row_count??'—')} source rows · ${e(f.identity_status||'—')}</small></td><td data-duration="${i}">${['.csv','.bak'].includes(f.kind)?'Loading…':'—'}</td><td>${bytes(f.bytes)}</td><td>${e(dateLabel(fileDate(f)))}</td><td data-pass="${i}">—</td><td><div class="row-actions"><button data-download="${i}">Download</button>${['.csv','.bak'].includes(f.kind)?`<button class="secondary" data-preview="${i}">View rows</button><a href="/data-portal/preview.html?file=${encodeURIComponent(f.id)}">Preview</a>`:''}</div></td></tr>`).join('')||'<tr><td colspan="6">No files match these filters.</td></tr>';
  container.querySelector('#file-pages').innerHTML=`${page?'<button data-prev>Previous files</button>':''}<span>Page ${page+1} of ${Math.max(1,Math.ceil(visible.length/25))}</span>${(page+1)*25<visible.length?'<button data-next>Next files</button>':''}`;
  container.querySelector('#file-pages [data-prev]')?.addEventListener('click',()=>{page--;draw();});
  container.querySelector('#file-pages [data-next]')?.addEventListener('click',()=>{page++;draw();});
  container.querySelectorAll('[data-download]').forEach(b=>b.addEventListener('click',async()=>{
   b.disabled=true;try{const f=currentFiles[Number(b.dataset.download)],a=document.createElement('a');a.href=await artifactUrl(f,true);a.download=f.original_path.split('/').at(-1);a.click();}catch(error){status.textContent=error.message;}finally{b.disabled=false;}
  }));
  container.querySelectorAll('[data-preview]').forEach(b=>b.addEventListener('click',()=>preview(currentFiles[Number(b.dataset.preview)])));
  currentFiles.forEach((f,i)=>{
   if(!['.csv','.bak'].includes(f.kind))return;
   if(current!==generation)return;
   if(f.metrics){const m=f.metrics;container.querySelector(`[data-duration="${i}"]`).innerHTML=durationStack(m);container.querySelector(`[data-pass="${i}"]`).textContent=`${percent(m.catchCorrect,m.catchTotal)} (${m.catchCorrect}/${m.catchTotal})`;}
   else{container.querySelector(`[data-duration="${i}"]`).textContent='Unavailable';container.querySelector(`[data-pass="${i}"]`).textContent='Unavailable';status.textContent='Some session metrics are unavailable.';}
  });
 }
 async function preview(file) {
  const current=++previewGeneration;status.textContent='Loading preserved rows…';
  try{const {csv,metrics}=await artifactData(file);if(current!==previewGeneration)return;renderPreview(container.querySelector('#file-preview'),file,csv,metrics);status.textContent='Original file checksum verified.';}
  catch(error){if(current===previewGeneration)status.textContent=error.message;}
 }
 form.addEventListener('submit',event=>{event.preventDefault();page=0;draw();});
 form.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{page=0;draw();}));
 await draw();
 if(explicit){const file=files.find(f=>f.id===explicit||f.original_path===explicit);if(file)await preview(file);else status.textContent='The selected file is unavailable or outside your account access.';}
}
export async function mapLimited(items,fn) {
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;await fn(items[i],i);}}));
}
export async function renderOverview(container,participantId=null,{singleUser=false,username=''}={}) {
 container.innerHTML='<h2>User overview and trends</h2><p role="status">Loading authorized results…</p>';
 container.innerHTML=`<h2>Progress overview${username?' · '+e(username):''}</h2><div class="filters"><label>Results source<select id="results-source"><option value="historical">Historical files</option><option value="recorded">Recorded runs</option></select></label><label ${singleUser?'hidden':''}>Participant<select id="results-user"></select></label><label>Difficulty task<select id="results-task">${TASKS.map(t=>`<option>${t}</option>`).join('')}</select></label></div><p class="note">Session dates use Eastern time. Choose historical files or recorded runs to view your results.</p><div class="filter-toggles" id="task-toggles">${TASKS.map(t=>`<label class="check"><input type="checkbox" value="${t}" checked>${t}</label>`).join('')}</div><p role="status" id="trend-status"></p><div id="trend-loading" class="metrics-loading" hidden><progress id="trend-progress" max="1" value="0" aria-labelledby="trend-status" aria-describedby="trend-progress-detail"></progress><span id="trend-progress-detail"></span></div><div id="overview-table"></div><div id="trend-summary"></div><div id="trend-charts" class="chart-grid"></div>`;
 const source=container.querySelector('#results-source'),users=container.querySelector('#results-user'),task=container.querySelector('#results-task'),status=container.querySelector('#trend-status');
 let sessions=[],generation=0,controller;
 const names=new Map();
 if(participantId&&username)names.set(participantId,username);
 async function load({fallback=false}={}) {
  controller?.abort();controller=new AbortController();const signal=controller.signal;
  const current=++generation;status.textContent='Loading session metrics…';sessions=[];
  const loading=container.querySelector('#trend-loading'),progress=container.querySelector('#trend-progress'),detail=container.querySelector('#trend-progress-detail');
  loading.hidden=false;progress.max=1;progress.value=0;detail.textContent='Finding sessions…';
  const onProgress=(completed,total)=>{
   if(current!==generation)return;
   progress.max=Math.max(1,total);progress.value=completed;
   detail.textContent=`${completed} / ${total} sessions · ${total?Math.floor(completed/total*100):100}%`;
  };
  container.querySelector('#overview-table').innerHTML='';container.querySelector('#trend-charts').innerHTML='';container.querySelector('#trend-summary').innerHTML='';
  let loaded=[];
  try{
   loaded=await sessionSummaries(participantId,source.value,{onProgress,signal});
   if(fallback&&!loaded.length&&!signal.aborted){source.value='recorded';loaded=await sessionSummaries(participantId,'recorded',{onProgress,signal});}
   if(current!==generation)return;
   const failures=loaded.filter(s=>!s.metrics).length;
   sessions=loaded.filter(s=>s.metrics);
   for(const s of sessions)if(s.username&&!names.has(s.participantId))names.set(s.participantId,s.username);
   sessions.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.id.localeCompare(b.id));
   const ids=[...new Set(sessions.map(s=>s.participantId))];
   users.innerHTML=ids.map(id=>`<option value="${e(id)}">${e(names.get(id)||id)}</option>`).join('');
   status.textContent=failures?`${failures} session summaries are unavailable. Charts show ${sessions.length} sessions; results are incomplete.`:`${sessions.length} sessions loaded.`;
   render();
  }catch(error){if(current===generation)status.textContent=error.message;}
  finally{if(current===generation)loading.hidden=true;}
 }
 function render() {
  const ids=[...new Set(sessions.map(s=>s.participantId))];
  container.querySelector('#overview-table').innerHTML=`<div class="table-scroll"><table><thead><tr><th>User</th><th>Sessions</th><th>Responses</th><th>Accuracy</th><th>Training</th><th>Resting</th><th>Latest session (Eastern)</th></tr></thead><tbody>${ids.map(id=>{
   const list=sessions.filter(s=>s.participantId===id),total=list.reduce((n,s)=>n+s.metrics.total,0),correct=list.reduce((n,s)=>n+s.metrics.correct,0);
   return `<tr><td>${singleUser?e(names.get(id)||id):`<button class="secondary" data-user="${e(id)}">${e(names.get(id)||id)}</button>`}</td><td>${list.length}</td><td>${total}</td><td>${percent(correct,total)}</td><td>${duration(list.reduce((n,s)=>n+s.metrics.trainingMs,0))}</td><td>${duration(list.reduce((n,s)=>n+s.metrics.restingMs,0))}</td><td>${e(dateLabel(list.at(-1)?.date))}</td></tr>`;
  }).join('')||'<tr><td colspan="7">No sessions are available.</td></tr>'}</tbody></table></div>`;
  container.querySelectorAll('[data-user]').forEach(b=>b.addEventListener('click',()=>{users.value=b.dataset.user;render();}));
  const activeTasks=[...container.querySelectorAll('#task-toggles input:checked')].map(i=>i.value);
  const all=sessions.filter(s=>s.participantId===users.value).map((s,i)=>({...s,index:i+1}));
  for(const t of TASKS){const taskSessions=all.filter(s=>s.task===t);taskSessions.forEach((s,i)=>{s.opacity=taskSessions.length===1?1:.35+.65*i/(taskSessions.length-1);});}
  const list=all.filter(s=>activeTasks.includes(s.task));
  const combined=list.reduce((m,s)=>{for(const key of Object.keys(m))m[key]+=s.metrics[key]||0;return m;},{total:0,correct:0,trainingMs:0,restingMs:0,catchCorrect:0,catchTotal:0});
  container.querySelector('#trend-summary').innerHTML=summary(combined);
  const accuracy=TASKS.filter(t=>activeTasks.includes(t)).map(t=>({name:t,values:list.filter(s=>s.task===t).map(s=>({x:s.index,y:s.metrics.total?s.metrics.correct/s.metrics.total*100:NaN,opacity:s.opacity,detail:`${dateLabel(s.date)}; ${s.metrics.correct}/${s.metrics.total} correct`}))}));
  const times=TASKS.filter(t=>activeTasks.includes(t)).map(t=>({name:t,color:COLORS[t],values:list.filter(s=>s.task===t).map(s=>({x:s.index,y:s.metrics.trainingMs/60000,opacity:s.opacity,detail:dateLabel(s.date)}))}));
  const difficulty=all.filter(s=>s.task===task.value);
  const byDifficulty=(key)=>difficulty.map(s=>({name:`Session ${s.index} · ${dateKey(s.date)}`,color:COLORS[task.value],opacity:s.opacity,values:s.metrics.levels.filter(g=>g.task===task.value).map(g=>({x:g.level,y:key==='accuracy'?g.accuracy:g.averageDurationMs/1000,detail:`${g.total} responses; ${s.label}`}))}));
  const levelTrend=[{name:task.value,values:difficulty.map(s=>({x:s.index,y:s.metrics.total?s.metrics.meanDifficulty:NaN,opacity:s.opacity,detail:dateLabel(s.date)}))}];
  container.querySelector('#trend-charts').innerHTML=chart('Accuracy across sessions',accuracy)+chart('Training time across sessions',times,{yLabel:'Duration (minutes)',max:null,format:v=>v.toFixed(1)})+chart(`${task.value}: difficulty across sessions`,levelTrend,{yLabel:'Mean difficulty level',max:8,format:v=>v.toFixed(1)})+chart(`${task.value}: accuracy by difficulty across sessions`,byDifficulty('accuracy'),{xLabel:'Difficulty level'})+chart(`${task.value}: time by difficulty across sessions`,byDifficulty('duration'),{xLabel:'Difficulty level',yLabel:'Average trial duration (seconds)',max:null,format:v=>v.toFixed(1)});
  bindCharts(container);
 }
 source.addEventListener('change',()=>load());users.addEventListener('change',render);task.addEventListener('change',render);container.querySelectorAll('#task-toggles input').forEach(i=>i.addEventListener('change',render));
 await load({fallback:true});
}

export function renderRunHistory(container,dashboard,url) {
 if(!dashboard.totalRuns)return;
 const details=document.createElement('details');details.id='recorded-history';
 const page=Math.max(0,Number(url.searchParams.get('page')||0));
 const link=(n,label)=>{const next=new URL(url);next.searchParams.set('page',n);return `<a href="${e(next.pathname+next.search)}">${label}</a>`;};
 details.innerHTML=`<summary>Recorded sessions (${dashboard.totalRuns})</summary><div class="table-scroll"><table><thead><tr><th>Task</th><th>Started (Eastern)</th><th>Status</th><th>Results</th></tr></thead><tbody>${dashboard.runs.map(run=>`<tr><td>${e(run.task)}</td><td>${e(dateLabel(run.started_at))}</td><td>${e(run.status)}</td><td><a href="/data-portal/preview.html?run=${e(run.id)}">Preview run</a></td></tr>`).join('')}</tbody></table></div><nav aria-label="Session pages">${page?link(page-1,'Previous sessions'):''}${(page+1)*25<dashboard.totalRuns?link(page+1,'Next sessions'):''}</nav>`;
 container.appendChild(details);
}
