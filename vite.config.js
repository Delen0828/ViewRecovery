import {defineConfig} from 'vite';
import {createClient} from '@supabase/supabase-js';
import {readLocalEnv} from './scripts/lib/local-env.mjs';
import {createAuthHandler} from './supabase/functions/_shared/auth-handler.js';
import fs from 'node:fs';
export default defineConfig(({command})=>{
 const env=fs.existsSync('env/staging.env')?readLocalEnv():process.env;
 const clientOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const plugins=[];
 if(command==='serve' && env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY)) plugins.push({
  name:'local-auth-bridge',configureServer(server) {
   server.middlewares.use('/api/auth',async(req,res)=>{
    try {
     if(req.method!=='POST' && req.method!=='OPTIONS') {res.statusCode=405;res.end();return;}
     const chunks=[];let bytes=0;
     for await(const chunk of req) {bytes+=chunk.length;if(bytes>8192){res.statusCode=413;res.end();return;}chunks.push(chunk);}
     const request=new Request(new URL('/api/auth',env.AUTH_REDIRECT_URL),{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks).toString('utf8'):undefined});
     const handler=createAuthHandler({admin:createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,clientOptions),publicClientFactory:()=>createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,clientOptions),redirectUrl:env.AUTH_REDIRECT_URL,salt:env.AUTH_RATE_LIMIT_SALT,trustedIp:()=>req.socket.remoteAddress});
     const response=await handler(request);
     res.statusCode=response.status;for(const [key,value] of response.headers) res.setHeader(key,value);
     res.end(await response.text());
    } catch {res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Authentication temporarily unavailable.'}));}
   });
  }
 });
 return {plugins,define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(env.VITE_SUPABASE_URL||''),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY||'')},build:{rollupOptions:{input:{experiment:'index.html',portal:'data-portal/index.html',users:'data-portal/users.html',preview:'data-portal/preview.html'}}}};
});
