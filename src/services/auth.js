import {requireClient} from './supabase.js';
export async function getVerifiedSession() {
 const client=requireClient();
 const {data:{session}}=await client.auth.getSession();
 if(!session) return null;
 const {data:{user},error}=await client.auth.getUser();
 if(error || !user?.email_confirmed_at) return null;
 return {...session,user};
}
export async function authAction(body) {
 let data,error;
 if(import.meta.env.DEV) {
   const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   data=await response.json();
   if(!response.ok) error=new Error(data.message||'Authentication failed.');
 } else {
   const result=await requireClient().functions.invoke('username-auth',{body});
   data=result.data;error=result.error;
   if(error?.context instanceof Response) {try {data=await error.context.json();} catch{}}
 }
 if(error) {const failure=new Error(data?.message||'Authentication could not be completed.');failure.code=data?.code;throw failure;}
 if(data.session) {
  const {error:setError}=await requireClient().auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  if(setError) throw new Error('Could not establish a session. Please sign in again.');
 }
 return data;
}
export async function logout() {
 const {error}=await requireClient().auth.signOut({scope:'local'});
 if(error) throw new Error('Sign-out failed. Please try again.');
}
