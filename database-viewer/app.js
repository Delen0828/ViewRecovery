const $ = id=>document.getElementById(id);
let token='';
let sourceOffset=0,sourceTotal=0,rowOffset=0,rowTotal=0,selected;
const limit=50;
let generation=0;
function cell(value,tag='td') {
  const element=document.createElement(tag);
  element.textContent=value===undefined ? '' : typeof value==='object' ? JSON.stringify(value) : String(value);
  return element;
}
async function api(path) {
  const response=await fetch('/api/database/'+path,{headers:token ? {Authorization:'Bearer '+token} : {}});
  const result=await response.json();
  if (!response.ok) {
    if (response.status===401) $('auth').hidden=false;
    throw new Error(result.error || 'Database request failed');
  }
  $('auth').hidden=true;
  return result;
}
function error(err) {$('status').textContent=err.message;$('status').className='error';}
function pager(prefix,offset,total) {
  $(prefix+'-page').textContent=total ? `${offset+1}–${Math.min(offset+limit,total)} of ${total}` : '0 rows';
  $(prefix+'-prev').disabled=offset===0;
  $(prefix+'-next').disabled=offset+limit>=total;
}
async function loadRows() {
  if (!selected) return;
  const turn=++generation;
  const result=await api(`rows/${selected.kind}/${selected.id}?offset=${rowOffset}&limit=${limit}`);
  if (turn!==generation) return;
  rowTotal=result.total;
  const columns=[...new Set(result.rows.flatMap(row=>Object.keys(row.payload)))];
  const heading=document.createElement('tr');
  heading.append(cell('#','th'),cell('Included','th'),...columns.map(name=>cell(name,'th')));
  $('row-head').replaceChildren(heading);
  $('rows').replaceChildren(...result.rows.map(row=>{
    const tr=document.createElement('tr');
    if (row.included===false) tr.className='excluded';
    tr.append(cell(row.ordinal),cell(row.included===undefined ? '—' : row.included),...columns.map(name=>cell(row.payload[name])));
    return tr;
  }));
  $('preview-title').textContent=selected.name;
  $('preview').hidden=false;
  pager('row',rowOffset,rowTotal);
}
async function loadSources() {
  const params=new URLSearchParams({user_id:$('participant').value.trim(),task:$('task').value,offset:sourceOffset,limit});
  const result=await api('sources?'+params);
  sourceTotal=result.total;
  $('sources').replaceChildren(...result.sources.map(source=>{
    const tr=document.createElement('tr');tr.tabIndex=0;
    tr.append(...[source.kind,source.user_id || '—',source.task || '—',source.name,source.status,source.row_count].map(value=>cell(value)));
    const open=()=>{selected=source;rowOffset=0;loadRows().catch(error);};
    tr.addEventListener('click',open);
    tr.addEventListener('keydown',event=>{if(event.key==='Enter')open();});
    return tr;
  }));
  pager('source',sourceOffset,sourceTotal);
}
async function refresh() {
  try {
    const data=await api('overview');
    const labels={runs:'Recorded runs',events:'All live rows',included_rows:'Included live rows',saves:'Checkpoints and saves',source_files:'Imported files',source_rows:'Imported rows'};
    $('counts').replaceChildren(...Object.entries(data.counts).map(([key,value])=>{
      const box=document.createElement('div');box.className='count';box.append(cell(value.toLocaleString(),'strong'),cell(labels[key],'span'));return box;
    }));
    $('imports').replaceChildren(...data.imports.map(job=>{
      const div=document.createElement('div');div.className='import';
      div.textContent=`${job.archive_name}: ${job.report.files} files, ${job.report.rows.toLocaleString()} rows, ${job.report.identity_conflicts} filename/row identity mismatches preserved. Completed ${new Date(job.completed_at).toLocaleString()}. SHA-256: ${job.archive_sha256}`;
      return div;
    }));
    if (!data.imports.length) $('imports').textContent='No archive imported yet.';
    await loadSources();
    await loadRows();
    $('status').textContent='Connected to PostgreSQL · updated '+new Date().toLocaleTimeString();$('status').className='';
  } catch (err) {error(err);}
}
$('refresh').addEventListener('click',refresh);
$('auth').addEventListener('submit',event=>{event.preventDefault();token=$('token').value;refresh();});
$('filters').addEventListener('submit',event=>{event.preventDefault();sourceOffset=0;loadSources().catch(error);});
for (const [id,step] of [['source-prev',-limit],['source-next',limit]]) $(id).addEventListener('click',()=>{sourceOffset=Math.max(0,sourceOffset+step);loadSources().catch(error);});
for (const [id,step] of [['row-prev',-limit],['row-next',limit]]) $(id).addEventListener('click',()=>{rowOffset=Math.max(0,rowOffset+step);loadRows().catch(error);});
refresh();
