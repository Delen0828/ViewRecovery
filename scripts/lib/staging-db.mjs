import fs from 'node:fs';
export function stagingDatabaseConfig(env,applicationName) {
 const url=new URL(env.DATABASE_URL),ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
 const direct=url.hostname===`db.${ref}.supabase.co` && decodeURIComponent(url.username)==='postgres';
 const pooled=url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username)===`postgres.${ref}` && (url.port===''||url.port==='5432');
 if(!direct && !pooled) throw Object.assign(new Error('Database target does not match the staging project'),{code:'DATABASE_TARGET_MISMATCH'});
 const ca=env.DATABASE_SSL_ROOT_CERT||'env/supabase-ca.crt';
 if(!fs.existsSync(ca)) throw Object.assign(new Error('Staging database CA certificate missing'),{code:'DATABASE_CA_MISSING'});
 // Always verify the CA and hostname, irrespective of defaults in installed pg versions.
 url.searchParams.set('sslmode','verify-full');
 url.searchParams.set('sslrootcert',ca);
 return {connectionString:url.toString(),connectionTimeoutMillis:15000,application_name:applicationName};
}
