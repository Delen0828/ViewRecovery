import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {selectServerPort} from '../scripts/select-server-port.mjs';

test('startup skips occupied ports and preserves an explicitly requested port', async t => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const port = listener.address().port;
  await assert.rejects(selectServerPort({port, fixed: true}), /already in use/);
  if (port < 65535) {
    const selected = await selectServerPort({port});
    assert.ok(selected > port);
    assert.equal(await selectServerPort({port: selected, fixed: true}), selected);
  } else {
    await assert.rejects(selectServerPort({port}), /No available port/);
  }

  // A failed preflight must exit the shell before npm rebuilds live study files.
  const child = spawn('bash', ['start-server.sh'], {
    cwd: new URL('../', import.meta.url),
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /already in use/);
  assert.equal(listener.listening, true);
});

test('startup rejects invalid port values', async () => {
  for (const port of [0, -1, 65536, 8000.5, 'invalid']) {
    await assert.rejects(selectServerPort({port}), /PORT must be an integer/);
  }
});
