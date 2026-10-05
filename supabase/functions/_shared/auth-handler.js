// Shared by the Edge Function, the local Vite server, and integration tests.
// Clients never receive username/email lookup results or privileged API clients.
export function normalizeUsername(value,legacy=false) {
  const label=typeof value==='string'?value.trim():'';
  const normalized=label.toLowerCase();
  if(!(legacy?/^[a-z0-9][a-z0-9_-]{0,31}$/:/^[a-z0-9][a-z0-9_-]{2,31}$/).test(normalized)) throw new Error('INVALID_USERNAME');
  return {label,normalized};
}
export function createAuthHandler({admin,publicClientFactory,redirectUrl,salt,trustedIp}) {
  const allowedOrigin=new URL(redirectUrl).origin;
  if(!salt || salt.length<32) throw new Error('AUTH_RATE_LIMIT_SALT_REQUIRED');
  const utf8=new TextEncoder();
  async function hash(value) {
    const key=await crypto.subtle.importKey('raw',utf8.encode(salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8.encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  }
  return async function handle(request) {
    const origin=request.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
    if(origin===allowedOrigin) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
    const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if(origin && origin!==allowedOrigin) return respond(403,{code:'ORIGIN_DENIED',message:'Request origin is not allowed.'});
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(request.method!=='POST') return respond(405,{message:'POST required.'});
    if(!request.headers.get('content-type')?.startsWith('application/json')) return respond(415,{message:'JSON required.'});
    if(Number(request.headers.get('content-length')||0)>8192) return respond(413,{message:'Request too large.'});
    let body;
    try {
      const reader=request.body?.getReader();
      if(!reader) throw new Error();
      const chunks=[];let total=0;
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        total+=value.length;
        if(total>8192){await reader.cancel();return respond(413,{message:'Request too large.'});}
        chunks.push(value);
      }
      const bytes=new Uint8Array(total);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error();
    } catch {return respond(400,{message:'Invalid request.'});}
    try {
      if(!['login','register','recover'].includes(body.action)) return respond(400,{message:'Invalid action.'});
      let label,normalized;
      if(body.action!=='recover') ({label,normalized}=normalizeUsername(body.username,body.action==='login'));
      if(body.action!=='login' && (typeof body.email!=='string' || body.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return respond(400,{message:'Enter a valid email address.'});
      if(body.action!=='recover' && (typeof body.password!=='string' || body.password.length>256 || body.password.length<(body.action==='register'?12:1))) return respond(400,{message:body.action==='register'?'Use a password of at least 12 characters.':'Enter your password.'});
      // The Edge runtime/local bridge supplies a trusted peer IP; never accept an IP in the JSON body.
      const ip=trustedIp(request);
      if(!ip) return respond(503,{message:'Authentication temporarily unavailable.'});
      for(const [kind,value,maximum] of [['ip',ip,30],['identity',normalized||body.email.trim().toLowerCase(),10]]) {
        const {data,error}=await admin.rpc('consume_auth_limit',{key_hash:await hash(`${kind}:${value}`),maximum,window_seconds:900});
        if(error) return respond(503,{message:'Authentication temporarily unavailable.'});
        if(!data) return respond(429,{code:'RATE_LIMITED',message:'Too many attempts. Please try again later.'});
      }
      const client=publicClientFactory();
      if(body.action==='recover') {
        // Generic reply whether the email exists or delivery is rejected; no username mapping is returned.
        await client.auth.resetPasswordForEmail(body.email.trim(),{redirectTo:redirectUrl});
        return respond(200,{message:'If that email has an account, a recovery link will be sent.'});
      }
      if(body.action==='register') {
        const {data:reservation,error:reservationError}=await admin.rpc('reserve_username',{username:normalized});
        if(reservationError) return respond(reservationError.code==='23505'?409:503,{code:reservationError.code==='23505'?'USERNAME_UNAVAILABLE':'REGISTRATION_UNAVAILABLE',message:reservationError.code==='23505'?'Username unavailable. Choose another username.':'Registration temporarily unavailable.'});
        const {error}=await client.auth.signUp({email:body.email.trim(),password:body.password,options:{emailRedirectTo:redirectUrl,data:{username:label,username_reservation:reservation}}});
        if(error) return respond(400,{message:'Registration could not be completed. Check your details or try again after the reservation expires.'});
        return respond(200,{message:'Check your email to verify your account, then sign in.'});
      }
      const {data:email,error:lookupError}=await admin.rpc('username_auth_email',{username:normalized});
      if(lookupError) return respond(503,{message:'Authentication temporarily unavailable.'});
      if(!email) return respond(404,{code:'USERNAME_NOT_REGISTERED',message:'Username not registered. Create an account.'});
      const {data,error}=await client.auth.signInWithPassword({email,password:body.password});
      if(error || !data.session) return respond(401,{code:'INVALID_CREDENTIALS',message:'Unable to sign in. Check your password and email verification.'});
      return respond(200,{session:data.session});
    } catch(error) {
      if(error.message==='INVALID_USERNAME') return respond(400,{message:'Username: 3–32 letters, numbers, underscores or hyphens; start with a letter or number.'});
      return respond(503,{message:'Authentication temporarily unavailable.'});
    }
  };
}
