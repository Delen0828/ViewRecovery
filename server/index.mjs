import http from 'node:http';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {openDatabase, projectRoot} from '../scripts/lib/postgres.mjs';
import {ingest, overview, sources, rows, fail} from './store.mjs';
import {AUTH_PATH,createPortalAuth} from './portal-auth.mjs';
import {portalFiles,portalTrends,portalPreview,portalDownload} from './portal-store.mjs';
import {portalUsers,managePortalUser,portalPreferences,savePortalPreferences,portalSchedule,savePortalSchedule,portalScheduleOverview} from './portal-workspace.mjs';

const require=createRequire(import.meta.url);
const d3Bundle=join(dirnamePackage('d3'),'dist/d3.min.js');
function dirnamePackage(name) {return resolve(require.resolve(name),'../..');}

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.mp3':'audio/mpeg','.png':'image/png','.ico':'image/x-icon'};
function json(response, status, value) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) fail('Request exceeds 32 MB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('Invalid JSON'); }
}
function page(url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('Invalid pagination');
  return {offset,limit};
}
function viewerAuthorized(request, token) {
  if (token) {
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') || '';
    const a=Buffer.from(supplied), b=Buffer.from(token);
    return a.length===b.length && timingSafeEqual(a,b);
  }
  // Public bindings require an explicit token for database reads.
  return !request.headers['x-forwarded-for'] && !request.headers['forwarded'] &&
    ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
}

export function createServer(pool, {dist = join(projectRoot,'dist'), viewerToken = process.env.DATABASE_VIEWER_TOKEN, host = process.env.HOST || '127.0.0.1', portalAuth = {}} = {}) {
  const auth=createPortalAuth(pool,portalAuth);
  const server=http.createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://localhost');
      if (url.pathname.startsWith(AUTH_PATH+'/')) {
        response.setHeader('X-Frame-Options','DENY');response.setHeader('X-Content-Type-Options','nosniff');
        response.setHeader('Cache-Control','no-store');
        return await auth.handler(request,response);
      }
      if (url.pathname.startsWith('/data-portal/api/') || url.pathname==='/data-portal/download') {
        response.setHeader('X-Frame-Options','DENY');response.setHeader('X-Content-Type-Options','nosniff');
        response.setHeader('Cache-Control','no-store');
        const session=await auth.session(request,response);
        if (!['GET','HEAD'].includes(request.method)) {
          const baseURL=portalAuth.baseURL || process.env.BETTER_AUTH_URL;
          const origins=typeof baseURL==='string' ? [new URL(baseURL).origin] : [`http://${request.headers.host}`,`https://${request.headers.host}`];
          if (!origins.includes(request.headers.origin)) fail('Origin is not allowed.',403);
          if (!request.headers['content-type']?.startsWith('application/json')) fail('Expected JSON.',415);
          if (url.pathname==='/data-portal/api/users' && ['POST','PATCH','DELETE'].includes(request.method)) return json(response,200,await managePortalUser(pool,session,request.method,await body(request)));
          if (url.pathname==='/data-portal/api/preferences' && request.method==='PUT') return json(response,200,await savePortalPreferences(pool,session,await body(request)));
          if (url.pathname==='/data-portal/api/schedule' && request.method==='PUT') return json(response,200,await savePortalSchedule(pool,session,await body(request)));
          fail('Method not allowed',405);
        }
        if (request.method!=='GET') fail('Method not allowed',405);
        if (url.pathname==='/data-portal/api/session') return json(response,200,auth.state(session));
        if (url.pathname==='/data-portal/api/users') return json(response,200,await portalUsers(pool,session));
        if (url.pathname==='/data-portal/api/preferences') return json(response,200,await portalPreferences(pool,session,url.searchParams.get('user_id')));
        if (url.pathname==='/data-portal/api/schedule') return json(response,200,await portalSchedule(pool,session,url.searchParams.get('user_id')));
        if (url.pathname==='/data-portal/api/schedule/overview') return json(response,200,await portalScheduleOverview(pool,session));
        if (url.pathname==='/data-portal/api/files') return json(response,200,await portalFiles(pool,session,url.searchParams));
        if (url.pathname==='/data-portal/api/user-trends') return json(response,200,await portalTrends(pool,session));
        if (url.pathname==='/data-portal/api/preview') return json(response,200,await portalPreview(pool,session,url.searchParams.get('file') || ''));
        if (url.pathname==='/data-portal/download') {
          const data=await portalDownload(pool,session,url.searchParams.get('file') || '');
          const filename=data.name.split('/').at(-1);
          response.writeHead(200,{'Content-Type':data.type,'Content-Length':data.content.length,
            'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`});
          return response.end(data.content);
        }
        fail('Not found',404);
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/save_data.php') {
        if (url.pathname === '/api/health' && request.method === 'GET') {
          await pool.query('SELECT 1'); return json(response,200,{success:true,database:'postgresql'});
        }
        if (url.pathname === '/api/experiment/ingest' && request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`) fail('Origin is not allowed.',403);
          if (!request.headers['content-type']?.startsWith('application/json')) fail('Content-Type must be application/json.',415);
          return json(response,200,await ingest(pool,await body(request)));
        }
        if (url.pathname.startsWith('/api/database/')) {
          if (request.method !== 'GET') fail('Read-only endpoint.',405);
          if ((!viewerToken && !['127.0.0.1','localhost','::1'].includes(host)) || !viewerAuthorized(request,viewerToken)) fail('Database viewer requires a token for remote access.',401);
          if (url.pathname === '/api/database/overview') return json(response,200,await overview(pool));
          if (url.pathname === '/api/database/sources') return json(response,200,await sources(pool,{...page(url),user_id:url.searchParams.get('user_id') || '',task:url.searchParams.get('task') || ''}));
          const match = url.pathname.match(/^\/api\/database\/rows\/(run|save|source)\/([^/]+)$/);
          if (match) return json(response,200,await rows(pool,match[1],match[2],page(url)));
        }
        if (url.pathname === '/save_data.php') fail('CSV ingestion is retired. Use /api/experiment/ingest with JSON.',410);
        fail('Not found',404);
      }
      if (!['GET','HEAD'].includes(request.method)) fail('Method not allowed',405);
      let path = decodeURIComponent(url.pathname);
      let root = resolve(dist);
      if (path==='/data-portal' || path==='/data-portal/') {
        response.writeHead(302,{Location:'/data-portal/index.html'});return response.end();
      }
      if (path.startsWith('/data-portal/')) {
        if (!['/data-portal/index.html','/data-portal/users.html','/data-portal/preview.html','/data-portal/d3.min.js'].includes(path)) fail('Not found',404);
        if (path==='/data-portal/d3.min.js') {
          response.writeHead(200,{'Content-Type':types['.js'],'X-Content-Type-Options':'nosniff'});
          if (request.method==='HEAD') return response.end();
          return createReadStream(d3Bundle).on('error',()=>response.destroy()).pipe(response);
        }
      }
      if (path === '/database' || path.startsWith('/database/')) {
        root = join(projectRoot,'database-viewer');
        path = path.replace(/^\/database/, '') || '/index.html';
        if (path === '/') path = '/index.html';
      }
      if (path === '/') path = '/index.html';
      // Never expose data directories, PHP source, or files outside the public roots.
      if (path.includes('\0') || path.split('/').some(part=>part.startsWith('.') || part==='data') || path.endsWith('.php')) fail('Not found',404);
      let file = resolve(root, '.'+path);
      if (!file.startsWith(root+'/')) fail('Not found',404);
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (root !== resolve(dist) || extname(path)) fail('Not found',404);
        file = join(root,'index.html');
      }
      if (!existsSync(file)) fail('Build missing. Run npm run build.',503);
      response.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error',()=>response.destroy()).pipe(response);
    } catch (error) {
      if (!error.status) console.error('[Server]',error.message);
      json(response,error.status || 500,{success:false,error:error.status ? error.message : 'Database request failed; data was not acknowledged.'});
    }
  });
  server.portalAuthReady=auth.ready;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = await openDatabase();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8000);
  const server = createServer(pool,{host});
  await server.portalAuthReady;
  server.listen(port,host,()=>console.log(`Experiment: http://${host}:${port}\nData portal: http://${host}:${port}/data-portal/\nDatabase viewer: http://${host}:${port}/database\nPostgreSQL ready. Historical import is a separate command.`));
  server.on('error',async error=>{ console.error(error.message); await pool.end(); process.exitCode=1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
    server.close(async()=>{await pool.end();process.exit(0);});
  });
}
