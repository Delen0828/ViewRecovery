import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase=url && key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}}):null;
export function requireClient() {
 if(!supabase) throw new Error('Supabase client configuration is missing. Configure this environment before signing in.');
 return supabase;
}
