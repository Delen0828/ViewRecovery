import {escapeHtml as e} from './auth/ui.js';
import {userDirectory} from './services/portal.js';

export function accountShell(profile,access,page,selected=null) {
 const admin=access==='admin',suffix=admin&&selected?'?user='+encodeURIComponent(selected):'';
 const items=[['progress',admin?'User progress':'My progress','/dashboard'+suffix],['settings','Training settings','/settings'+suffix],['account','Account','/account']];
 if(admin)items.push(['files','File download','/data-portal/'+suffix]);
 return `<main class="account-shell"><header><strong>${e(profile.display_username)}${admin?' <span class="role-label">Administrator</span>':''}</strong><nav aria-label="Main menu">${items.map(([key,label,path])=>`<a href="${e(path)}" ${key===page?'aria-current="page"':''}>${label}</a>`).join('')}</nav><button id="sign-out" class="secondary">Sign out</button></header><h1>${page==='progress'?(admin?'User progress':'My progress'):page==='settings'?'Training settings':page==='files'?'File download':page==='preview'?'Results preview':'Account'}</h1><p id="dashboard-status" role="status"></p>${admin&&['progress','settings','files'].includes(page)?'<section id="user-selector" class="account-card user-picker-card"></section>':''}<section id="page-content" class="account-card"></section></main>`;
}

// Search is paged on the server; large directories never become a giant select.
export async function renderUserSelector(container,selected,{allowAll=false}={}) {
 container.innerHTML=`<label for="selected-user">User ID</label><div class="user-picker"><div class="user-picker-input"><input id="selected-user" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="user-options" autocomplete="off" maxlength="32" value="${e(selected?.profile.display_username||'')}" placeholder="${allowAll?'All users — select or search user ID':'Select or search user ID'}"><button type="button" class="secondary" aria-label="Show users">▾</button></div><div class="user-picker-popup" hidden><div id="user-options" role="listbox" aria-label="User IDs"></div><div class="user-picker-pages"></div><p class="note" role="status" aria-live="polite"></p></div></div>`;
 const input=container.querySelector('input'),popup=container.querySelector('.user-picker-popup'),options=container.querySelector('[role=listbox]'),pages=container.querySelector('.user-picker-pages'),status=container.querySelector('[role=status]');
 let generation=0,page=0,search='',active=-1,timer,loaded=false;
 function open(){popup.hidden=false;input.setAttribute('aria-expanded','true');if(!loaded)load();}
 function close(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
 function choose(id){const url=new URL(location.href);for(const key of ['file','run','page','runPage','search','files'])url.searchParams.delete(key);if(id)url.searchParams.set('user',id);else url.searchParams.delete('user');location.assign(url.pathname+url.search);}
 async function load() {
  const current=++generation;loaded=true;status.textContent='Loading users…';active=-1;input.removeAttribute('aria-activedescendant');
  options.innerHTML='';pages.innerHTML='';
  try {
   const directory=await userDirectory(search,page);if(current!==generation)return;
   options.innerHTML=(allowAll&&!search&&page===0?'<button type="button" role="option" id="user-option-all" data-user="" aria-selected="false">All users</button>':'')+directory.users.map((u,i)=>`<button type="button" role="option" id="user-option-${i}" data-user="${e(u.participant_id)}" aria-selected="${u.participant_id===selected?.participant.id}"><span>${e(u.username)}</span><small>${e(u.participant_id)}</small></button>`).join('');
   status.textContent=directory.total?`${page*50+1}–${Math.min((page+1)*50,directory.total)} of ${directory.total} users`:'No users match this ID.';
   pages.innerHTML=`${page?'<button type="button" class="secondary" data-prev>Previous users</button>':''}${(page+1)*50<directory.total?'<button type="button" class="secondary" data-next>Next users</button>':''}`;
   options.querySelectorAll('[role=option]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.user)));
   pages.querySelector('[data-prev]')?.addEventListener('click',()=>{page--;load();});pages.querySelector('[data-next]')?.addEventListener('click',()=>{page++;load();});
  }catch(error){if(current===generation)status.textContent=error.message;}
 }
 input.addEventListener('focus',open);
 container.querySelector('[aria-label="Show users"]').addEventListener('click',()=>{if(popup.hidden){input.focus();open();}else close();});
 input.addEventListener('input',()=>{clearTimeout(timer);search=input.value.trim();page=0;generation++;loaded=false;options.innerHTML='';pages.innerHTML='';status.textContent='Searching users…';popup.hidden=false;input.setAttribute('aria-expanded','true');timer=setTimeout(load,180);});
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
  event.preventDefault();open();const list=[...options.querySelectorAll('[role=option]')];
  if(event.key==='Enter'){if(list[active])choose(list[active].dataset.user);else if(list.length===1)choose(list[0].dataset.user);return;}
  if(!list.length)return;
  active=event.key==='ArrowDown'?Math.min(active+1,list.length-1):Math.max(active-1,0);
  list.forEach((button,i)=>button.classList.toggle('active-option',i===active));input.setAttribute('aria-activedescendant',list[active].id);list[active].scrollIntoView({block:'nearest'});
 });
 document.addEventListener('click',event=>{if(!event.composedPath().includes(container))close();});
}
