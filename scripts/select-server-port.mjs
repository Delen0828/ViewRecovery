import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function selectServerPort({host = '127.0.0.1', port = 8000, fixed = false} = {}) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  for (let candidate = port; candidate <= 65535; candidate++) {
    try {
      await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen({host, port: candidate, exclusive: true}, () => probe.close(resolve));
      });
      return candidate;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (fixed) {
        throw new Error(`Port ${port} on ${host} is already in use. Choose another port, e.g. PORT=${port < 65535 ? port + 1 : 8000} bash start-server.sh.`);
      }
    }
  }
  throw new Error(`No available port on ${host} from ${port} through 65535.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = await selectServerPort({
      host: process.env.HOST || '127.0.0.1',
      port: process.env.PORT || 8000,
      fixed: Boolean(process.env.PORT)
    });
    if (!process.env.PORT && port !== 8000) {
      console.error(`Port 8000 is in use; starting the experiment on port ${port}.`);
    }
    console.log(port);
  } catch (error) {
    console.error(`Cannot start experiment: ${error.message}`);
    process.exitCode = 1;
  }
}
