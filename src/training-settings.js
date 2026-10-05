import {requireClient} from './services/supabase.js';
import {escapeHtml as e} from './auth/ui.js';
import {TASKS} from './portal-metrics.js';
import {setRunContext} from './experiment/context.js';
export function observedDisplay(measurements) {
 return {...measurements,viewport_width:innerWidth,viewport_height:innerHeight,screen_width:screen.width,screen_height:screen.height,dpr:devicePixelRatio,fullscreen:Boolean(document.fullscreenElement)};
}
export function geometry(display,settings,task) {
 const {viewport_width:w,viewport_height:h,screen_width:sw,screen_height:sh,width_cm:cmw,height_cm:cmh,distance_cm:d}=display;
 if([w,h,sw,sh,cmw,cmh,d].some(n=>!Number.isFinite(n)||n<=0))throw new Error('Enter positive measured screen dimensions and viewing distance.');
 if([cmw,cmh,d].some(n=>n>1000))throw new Error('Measurements must be between 1 and 1000 cm.');
 const {x_deg:x,y_deg:y}=settings;
 if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>80||Math.abs(y)>80)throw new Error('Offsets must be between −80 and 80 degrees.');
 if(task==='Bar'&&x<0)throw new Error('Bar X offset must be zero or greater.');
 const xpx=d*Math.tan(x*Math.PI/180)*sw/cmw,ypx=d*Math.tan(y*Math.PI/180)*sh/cmh;
 const ppd=d*Math.tan(Math.PI/180)*(sw/cmw+sh/cmh)/2;
 const halfw=task==='Bar'?15:task==='Centrality'?50:ppd*2.5+(task==='Motion'?4:0);
 const halfh=task==='Bar'?50:task==='Centrality'?50:halfw;
 const centers=[{x:w/2-xpx,y:h/2-ypx}];if(task==='Bar')centers.push({x:w/2+xpx,y:h/2-ypx});
 if(centers.some(c=>c.x-halfw<0||c.x+halfw>w||c.y-halfh<0||c.y+halfh>h))throw new Error('The full stimulus extends offscreen. Reduce the offsets or viewing distance.');
 return {xpx,ypx,ppd,halfw,halfh,centers};
}
function renderSavedTraining(container,dashboard,displays,training,initialTask) {
 const studies=dashboard.studies.filter(s=>training.some(t=>t.study_id===s.id)||dashboard.enrollments.some(en=>en.study_id===s.id));
 const fields=[['display_name','Display name'],['width_cm','Visible screen width (cm)'],['height_cm','Visible screen height (cm)'],['distance_cm','Viewing distance (cm)'],['x_deg','X offset (degrees)'],['y_deg','Y offset (degrees)']];
 container.innerHTML=`<h2>Saved training configuration · ${e(dashboard.profile.display_username)}</h2><p class="note">These settings were saved by this user. The position preview uses their saved display dimensions.</p><div class="settings-grid"><label>Study<select id="saved-study">${studies.map(s=>`<option value="${e(s.id)}">${e(s.name)}${s.active?'':' (inactive)'}</option>`).join('')||'<option>No enrolled studies</option>'}</select></label><label>Task<select id="saved-task">${TASKS.map(t=>`<option ${t===initialTask?'selected':''}>${t}</option>`).join('')}</select></label>${fields.map(([key,label])=>`<label>${label}<input name="${key}" readonly aria-readonly="true"></label>`).join('')}</div><p id="saved-settings" class="note"></p><svg id="training-preview" class="training-preview" role="img" aria-label="Saved stimulus position preview" hidden></svg><p id="geometry-readout" class="note"></p><p id="training-status" role="status"></p>`;
 const study=container.querySelector('#saved-study'),task=container.querySelector('#saved-task'),svg=container.querySelector('svg');
 const initial=training.find(t=>t.task===initialTask)||training[0];if(initial){study.value=initial.study_id;task.value=initial.task;}
 function draw() {
  const setting=training.find(t=>t.study_id===study.value&&t.task===task.value),profile=displays.find(d=>d.id===setting?.display_profile_id),display=profile?.settings;
  for(const [key] of fields)container.querySelector(`[name="${key}"]`).value=key==='display_name'?profile?.name||'':setting?(key==='x_deg'||key==='y_deg'?setting.settings[key]??'':display?.[key]??''):'';
  container.querySelector('#saved-settings').textContent=setting?`Task configuration version ${setting.version} · Display version ${profile?.version??'—'} · ${setting.confirmed_at?'Confirmed '+new Date(setting.confirmed_at).toLocaleString('en-US',{timeZone:'America/New_York'})+' (Eastern)':'Not yet confirmed for a run'}`:'';
  container.querySelector('#training-status').textContent=setting?'Viewing saved settings. Users edit and confirm their own configuration.':'This user has no saved configuration for this task and study.';
  svg.toggleAttribute('hidden',!setting||!display);svg.innerHTML='';container.querySelector('#geometry-readout').textContent='';
  if(!setting||!display)return;
  svg.setAttribute('viewBox',`0 0 ${display.viewport_width} ${display.viewport_height}`);
  try {
   const g=geometry(display,setting.settings,task.value);
   svg.innerHTML=`<rect width="100%" height="100%" fill="#f1f5f9"/><path d="M ${display.viewport_width/2} 0 V ${display.viewport_height} M 0 ${display.viewport_height/2} H ${display.viewport_width}" stroke="#cbd5e1"/><circle cx="${display.viewport_width/2}" cy="${display.viewport_height/2}" r="7" fill="#0f172a"/>`+g.centers.map(c=>task.value==='Motion'||task.value==='Orientation'?`<circle cx="${c.x}" cy="${c.y}" r="${g.halfw}" fill="#2563eb22" stroke="#2563eb" stroke-width="3"/>`:`<rect x="${c.x-g.halfw}" y="${c.y-g.halfh}" width="${g.halfw*2}" height="${g.halfh*2}" fill="#2563eb22" stroke="#2563eb" stroke-width="3"/>`).join('');
   container.querySelector('#geometry-readout').textContent=`Saved viewport ${display.viewport_width} × ${display.viewport_height} CSS pixels · DPR ${display.dpr} · ${g.ppd.toFixed(2)} pixels/degree · full stimulus fits.`;
  }catch(error){container.querySelector('#geometry-readout').textContent=error.message;}
 }
 study.addEventListener('change',draw);task.addEventListener('change',draw);draw();
}
export async function renderTraining(container,dashboard,ownerId,initialTask='Motion',{readOnly=false}={}) {
 const client=requireClient(),participant=dashboard.participant;
 const [displays,training]=await Promise.all([
  client.from('display_profiles').select('id,name,settings,version,confirmed_at').eq('auth_user_id',ownerId).order('updated_at',{ascending:false}),
  participant?client.from('training_settings').select('id,study_id,task,display_profile_id,settings,version,confirmed_at').eq('participant_id',participant.id):Promise.resolve({data:[],error:null})
 ]);
 if(displays.error||training.error)throw new Error('Could not load your saved training configuration.');
 if(readOnly){renderSavedTraining(container,dashboard,displays.data,training.data,initialTask);return;}
 const available=dashboard.studies.filter(s=>s.active&&dashboard.enrollments.some(en=>en.participant_id===participant?.id&&en.study_id===s.id&&en.active));
 container.innerHTML=`<h2>Personalized training configuration</h2><p>Measure the visible screen from edge to edge, excluding the frame. Measure from your eyes to the screen while seated for training.</p><form id="training-form"><div class="settings-grid"><label>Study<select name="study" ${available.length?'':'disabled'}>${available.map(s=>`<option value="${e(s.id)}">${e(s.name)}</option>`).join('')||'<option>Enrollment required</option>'}</select></label><label>Task<select name="task">${TASKS.map(t=>`<option ${t===initialTask?'selected':''}>${t}</option>`).join('')}</select></label><label>Display profile<select name="profile"><option value="">New display profile</option>${displays.data.map(d=>`<option value="${e(d.id)}">${e(d.name)}</option>`).join('')}</select></label><label>Display name<input name="display_name" value="Primary display" required maxlength="80"></label><label>Visible screen width (cm)<input name="width_cm" type="number" min="1" max="1000" step="0.1" placeholder="Measure width" required></label><label>Visible screen height (cm)<input name="height_cm" type="number" min="1" max="1000" step="0.1" placeholder="Measure height" required></label><label>Viewing distance (cm)<input name="distance_cm" type="number" min="1" max="1000" step="0.1" placeholder="Measure eye-to-screen distance" required></label><label>X offset (degrees)<input name="x_deg" type="number" min="-80" max="80" step="0.1" value="5" required></label><label>Y offset (degrees)<input name="y_deg" type="number" min="-80" max="80" step="0.1" value="5" required></label></div><p id="position-note" class="note"></p><svg id="training-preview" class="training-preview" role="img" aria-label="Stimulus position preview"></svg><p id="geometry-readout" class="note"></p><label class="check"><input type="checkbox" name="confirmation" required>I measured this display and viewing distance, and reviewed the stimulus position.</label><div class="row-actions"><button type="submit" ${available.length?'':'disabled'}>Save configuration</button><button type="button" id="start-training" ${available.length?'':'disabled'}>Confirm and start training</button></div><p class="note">Saving and starting use fullscreen measurements. Starting creates a run with a fixed copy of your confirmed settings.</p><p role="status" id="training-status">${available.length?'Choose or edit your personal settings.':'Study staff must enroll you before saving settings or starting a task.'}</p><p id="saved-settings" class="note"></p></form>`;
 const form=container.querySelector('form'),field=name=>form.elements.namedItem(name),status=container.querySelector('#training-status');
 let busy=false;
 function populate() {
  const study=available.find(s=>s.id===field('study').value);
  if(study?.tasks?.length) {
   for(const option of field('task').options)option.disabled=!study.tasks.includes(option.value);
   if(!study.tasks.includes(field('task').value))field('task').value=study.tasks[0];
  }
  const setting=training.data.find(t=>t.study_id===field('study').value&&t.task===field('task').value);
  const profile=displays.data.find(d=>d.id===setting?.display_profile_id)||displays.data[0];
  field('profile').value=profile?.id||'';fillDisplay(profile);
  field('x_deg').value=setting?.settings.x_deg??5;field('y_deg').value=setting?.settings.y_deg??5;
  field('confirmation').checked=false;
  container.querySelector('#saved-settings').textContent=setting?`Saved task configuration · version ${setting.version}. Review and confirm before the next run.`:'';
  preview();
 }
 function fillDisplay(profile) {
  field('display_name').value=profile?.name||'Primary display';
  for(const key of ['width_cm','height_cm','distance_cm'])field(key).value=profile?.settings[key]??'';
 }
 function values() {
  const measured=Object.fromEntries(['width_cm','height_cm','distance_cm'].map(key=>[key,field(key).value===''?NaN:Number(field(key).value)]));
  return {display:observedDisplay(measured),settings:{x_deg:field('x_deg').value===''?NaN:Number(field('x_deg').value),y_deg:field('y_deg').value===''?NaN:Number(field('y_deg').value),positions:[field('task').value==='Bar'?'upper':'left_upper']}};
 }
 function preview() {
  const task=field('task').value,{display,settings}=values(),svg=container.querySelector('#training-preview');
  field('x_deg').min=task==='Bar'?'0':'-80';
  container.querySelector('#position-note').textContent=task==='Bar'?'Protocol location: upper; two bars on either side of fixation. X offset must be nonnegative.':'Protocol location: left upper. Offsets place the stimulus relative to fixation.';
  svg.setAttribute('viewBox',`0 0 ${display.viewport_width} ${display.viewport_height}`);
  svg.innerHTML=`<rect width="100%" height="100%" fill="#f1f5f9"/><path d="M ${display.viewport_width/2} 0 V ${display.viewport_height} M 0 ${display.viewport_height/2} H ${display.viewport_width}" stroke="#cbd5e1"/><circle cx="${display.viewport_width/2}" cy="${display.viewport_height/2}" r="7" fill="#0f172a"/>`;
  try{
   const g=geometry(display,settings,task);
   svg.innerHTML+=g.centers.map(c=>task==='Motion'||task==='Orientation'?`<circle cx="${c.x}" cy="${c.y}" r="${g.halfw}" fill="#2563eb22" stroke="#2563eb" stroke-width="3"/>`:`<rect x="${c.x-g.halfw}" y="${c.y-g.halfh}" width="${g.halfw*2}" height="${g.halfh*2}" fill="#2563eb22" stroke="#2563eb" stroke-width="3"/>`).join('');
   container.querySelector('#geometry-readout').textContent=`${display.viewport_width} × ${display.viewport_height} CSS pixels · DPR ${display.dpr} · ${g.ppd.toFixed(2)} pixels/degree · X ${g.xpx.toFixed(1)} px · Y ${g.ypx.toFixed(1)} px · full stimulus fits.`;
  }catch(error){container.querySelector('#geometry-readout').textContent=error.message;}
 }
 async function save(start) {
  if(busy||!form.reportValidity())return;
  busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   const initial=values();geometry(initial.display,initial.settings,field('task').value);
   if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
   // Let the browser finish the viewport resize before binding the snapshot.
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const {display,settings}=values();geometry(display,settings,field('task').value);
   status.textContent='Saving your configuration…';
   const {data:saved,error}=await client.rpc('save_settings',{display_id:field('profile').value||null,display_name:field('display_name').value.trim(),display,study:field('study').value,task_name:field('task').value,settings});
   if(error)throw new Error(error.message);
   const dIndex=displays.data.findIndex(d=>d.id===saved.display.id);if(dIndex<0)displays.data.push(saved.display);else displays.data[dIndex]=saved.display;
   const tIndex=training.data.findIndex(t=>t.id===saved.training.id);if(tIndex<0)training.data.push(saved.training);else training.data[tIndex]=saved.training;
   if(![...field('profile').options].some(o=>o.value===saved.display.id))field('profile').add(new Option(saved.display.name,saved.display.id));
   field('profile').value=saved.display.id;
   container.querySelector('#saved-settings').textContent=`Saved task configuration · version ${saved.training.version}.`;
   status.textContent='Configuration saved to your account. Review and confirm when starting training.';
   if(start) {
    const result=await client.rpc('create_run',{training_id:saved.training.id,display_version:saved.display.version,training_version:saved.training.version,observed_display:observedDisplay({width_cm:display.width_cm,height_cm:display.height_cm,distance_cm:display.distance_cm})});
    if(result.error)throw new Error(result.error.message);
    setRunContext(result.data,ownerId);
    history.replaceState(null,'',`/${field('task').value}`);
    document.getElementById('portal')?.removeAttribute('class');
    const experiment=await import('./main.js');
    await experiment.startExperiment();
   }else if(document.fullscreenElement)await document.exitFullscreen();
  }catch(error){status.textContent=`Could not ${start?'start training':'save configuration'}: ${error.message}`;}
  finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);preview();}
 }
 form.addEventListener('submit',event=>{event.preventDefault();save(false);});
 container.querySelector('#start-training').addEventListener('click',()=>save(true));
 field('study').addEventListener('change',populate);field('task').addEventListener('change',populate);
 field('profile').addEventListener('change',()=>{fillDisplay(displays.data.find(d=>d.id===field('profile').value));field('confirmation').checked=false;preview();});
 form.querySelectorAll('input:not([type="checkbox"])').forEach(input=>input.addEventListener('input',()=>{field('confirmation').checked=false;preview();}));
 const resize=()=>{if(container.isConnected){field('confirmation').checked=false;preview();}else window.removeEventListener('resize',resize);};
 window.addEventListener('resize',resize);populate();
}
