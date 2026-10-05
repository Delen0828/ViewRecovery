import {accountShell,renderUserSelector} from './account-layout.js';
import {loadParticipantDashboard} from './services/dashboard.js';
import {renderArtifacts,renderOverview,renderRecordedRun,renderRunHistory} from './portal-results.js';
import {renderTraining} from './training-settings.js';
import {escapeHtml as e} from './auth/ui.js';
export {renderArtifacts} from './portal-results.js';

export async function renderAdmin(root,url,dashboard,ownerId,page,task='Motion') {
 const selectedId=url.searchParams.get('user')||(['progress','settings'].includes(page)?dashboard.participant?.id:null);
 root.innerHTML=accountShell(dashboard.profile,'admin',page,selectedId);
 const content=root.querySelector('#page-content');
 let selected;
 try{selected=selectedId?(selectedId===dashboard.participant?.id?dashboard:await loadParticipantDashboard(selectedId,Math.max(0,Number(url.searchParams.get('page')||0)))):null;}
 catch(error){content.innerHTML=`<p role="alert">${e(error.message)}</p>`;await renderUserSelector(root.querySelector('#user-selector'),null);return;}
 if(root.querySelector('#user-selector'))await renderUserSelector(root.querySelector('#user-selector'),selected,{allowAll:page==='files'});
 if(page==='preview') {
  if(url.searchParams.has('run'))await renderRecordedRun(content,url.searchParams.get('run'));
  else await renderArtifacts(content,url);
 } else if(page==='files') {
  content.innerHTML='<label class="check"><input id="unassigned-files" type="checkbox">Show only unassigned files</label><div id="historical-files"></div>';
  const checkbox=content.querySelector('#unassigned-files');checkbox.checked=url.searchParams.get('files')==='unassigned';
  checkbox.addEventListener('change',()=>{const next=new URL(location.href);if(checkbox.checked){next.searchParams.set('files','unassigned');next.searchParams.delete('user');}else next.searchParams.delete('files');location.assign(next.pathname+next.search);});
  await renderArtifacts(content.querySelector('#historical-files'),url,checkbox.checked?null:selectedId,checkbox.checked);
 } else if(!selected?.participant) {
  content.innerHTML='<p>Select a user ID to view their '+(page==='settings'?'training settings.':'progress.')+'</p>';
 } else if(page==='settings') {
  await renderTraining(content,selected,selected.participant.auth_user_id||ownerId,task,{readOnly:selected.participant.id!==dashboard.participant?.id});
 } else {
  await renderOverview(content,selected.participant.id,{singleUser:true,username:selected.profile.display_username});
  renderRunHistory(content,selected,url);
 }
}
