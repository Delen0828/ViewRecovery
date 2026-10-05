const tasks=['Motion','Orientation','Centrality','Bar'];
export function safeReturnPath(value,origin) {
 try {
  if(typeof value!=='string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/dashboard';
  const url=new URL(value,origin);
  if(url.origin!==origin || url.hash || url.username || url.password) return '/dashboard';
  const decoded=decodeURIComponent(url.pathname);
  if(decoded.includes('//') || decoded.includes('\\') || decoded.split('/').includes('..')) return '/dashboard';
  if(!['/','/dashboard','/admin',...tasks.map(t=>`/${t}`),'/data-portal','/data-portal/','/data-portal/index.html','/data-portal/users.html','/data-portal/preview.html','/settings','/account'].includes(url.pathname)) return '/dashboard';
  return url.pathname+url.search;
 } catch {return '/dashboard';}
}
export function taskFromPath(path) {
 try {return tasks.find(task=>task.toLowerCase()===decodeURIComponent(path).replace(/^\//,'').replace(/\/$/,'').toLowerCase())||null;} catch {return null;}
}
export function authPath(mode='login',returnPath='/dashboard',username='') {
 const params=new URLSearchParams({returnTo:returnPath});
 if(username) params.set('username',username);
 return `/auth/${mode}?${params}`;
}
