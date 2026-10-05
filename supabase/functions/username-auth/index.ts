import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthHandler } from '../_shared/auth-handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const serverKey=secretKeys.default || Object.values(secretKeys)[0] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const clientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
Deno.serve(createAuthHandler({
  admin:createClient(url,serverKey as string,clientOptions),
  publicClientFactory:()=>createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,clientOptions),
  redirectUrl:Deno.env.get('AUTH_REDIRECT_URL')!,
  salt:Deno.env.get('AUTH_RATE_LIMIT_SALT')!,
  // Supabase gateway supplies the connecting IP in x-forwarded-for. Use the last
  // entry, appended by the trusted proxy, rather than a caller-prepended entry.
  trustedIp:(request:Request)=>request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
}));
