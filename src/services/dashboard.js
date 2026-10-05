import {requireClient} from './supabase.js';
export async function loadDashboard(userId,page=0) {
 const {data,error}=await requireClient().rpc('portal_dashboard',{account_user:userId,run_offset:page*25});
 if(error||!data)throw new Error('Could not load your dashboard. Check your connection or sign in again.');
 return data;
}
export async function loadParticipantDashboard(participantId,page=0) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participantId))throw new Error('Invalid user selection.');
 const {data,error}=await requireClient().rpc('portal_dashboard',{selected_participant:participantId,run_offset:page*25});
 if(error||!data)throw new Error('User not found or outside your account access.');
 return data;
}
