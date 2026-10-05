import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const root = new URL('../', import.meta.url);
const serverPath = fileURLToPath(new URL('scripts/serve-built.mjs', root));
async function reservePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
function start(port) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: '/tmp', env: {...process.env, HOST: '127.0.0.1', PORT: String(port)},
  });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  return {child, output: () => output};
}

test('built static server serves deep routes, compiled portal and assets from dist only', async t => {
  const reservation = await reservePort();
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const {child, output} = start(port);
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) assert.fail(output());
    try { await fetch(base); break; } catch {
      if (attempt === 99) assert.fail('Static server did not become ready');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const index = await readFile(new URL('dist/index.html', root), 'utf8');
  for (const route of ['/', '/dashboard', '/auth/login', '/auth/recovery', '/Motion', '/settings']) {
    await t.test(route, async () => {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), index);
    });
  }
  for (const entry of ['data-portal/index.html', 'data-portal/users.html', 'data-portal/preview.html']) {
    await t.test(entry, async () => {
      const response = await fetch(base + '/' + entry, {redirect: 'manual'});
      assert.equal(response.status, 200, 'Keep explicit HTML URLs; no clean-URL redirects');
      assert.equal(await response.text(), await readFile(new URL('dist/' + entry, root), 'utf8'));
    });
  }
  await t.test('compiled JavaScript asset and HEAD', async () => {
    const asset = index.match(/src="(\/assets\/[^"\s]+\.js)"/)[1];
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(await response.text(), await readFile(new URL('dist' + asset, root), 'utf8'));
    const head = await fetch(base + asset, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
  await t.test('private env/source and legacy PHP are not served', async () => {
    for (const path of ['/env/staging.env', '/src/app.js', '/save_data.php', '/data_portal.php']) {
      const response = await fetch(base + path);
      assert.equal(await response.text(), index, 'Missing files use only the app fallback');
    }
  });
});

test('occupied port fails without silently opening a different port', async () => {
  const blocker = await reservePort();
  try {
    const {child, output} = start(blocker.address().port);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    const [code] = await once(child, 'exit');
    clearTimeout(timeout);
    assert.equal(code, 1);
    assert.match(output(), /EADDRINUSE/);
    assert.doesNotMatch(output(), /ViewRecovery listening/);
  } finally {
    await new Promise(resolve => blocker.close(resolve));
  }
});
