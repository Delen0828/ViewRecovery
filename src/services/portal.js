import {requireClient} from './supabase.js';
export async function accountAccess() {
 const {data,error}=await requireClient().rpc('account_access');
 if(error) throw new Error('Could not check account access.');
 return data==='admin'?'admin':'participant';
}
export async function userDirectory(search='',page=0) {
 const {data,error}=await requireClient().rpc('admin_user_status',{search,page_offset:page*50});
 if(error) throw new Error('Administrator access is required to view all users.');
 return {users:data,total:Number(data[0]?.total_users||0)};
}
export async function listArtifacts({participantId=null,page=0,unassigned=false}={}) {
 let query=requireClient().from('artifacts').select('id,participant_id,bucket,object_key,original_path,kind,bytes,row_count,task,identity_status',{count:'exact'}).order('original_path').order('id').range(page*25,page*25+24);
 if(participantId) query=query.eq('participant_id',participantId);
 if(unassigned) query=query.is('participant_id',null);
 const {data,error,count}=await query;
 if(error) throw new Error('Could not load historical files.');
 return {files:data,total:count||0};
}
export async function artifactUrl(artifact) {
 const {data,error}=await requireClient().storage.from(artifact.bucket).createSignedUrl(artifact.object_key,300);
 if(error) throw new Error('Could not authorize this file.');
 return data.signedUrl;
}
export async function artifactCsv(artifact) {
 const response=await fetch(await artifactUrl(artifact));
 if(!response.ok) throw new Error('Could not read this file.');
 const content=await response.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),n=>n.toString(16).padStart(2,'0')).join('');
 const {data,error}=await requireClient().from('artifacts').select('sha256').eq('id',artifact.id).single();
 if(error || data.sha256!==digest) throw new Error('File checksum did not match the preserved original.');
 return new TextDecoder('utf-8',{fatal:true}).decode(content);
}
