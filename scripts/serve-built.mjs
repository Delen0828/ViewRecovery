import http from 'node:http';
import {fileURLToPath} from 'node:url';
import handler from 'serve-handler';

const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[Error] PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const config = {
  public: fileURLToPath(new URL('../dist/', import.meta.url)),
  cleanUrls: false,
  directoryListing: false,
  symlinks: false,
  rewrites: [{source: '**', destination: '/index.html'}],
};
const server = http.createServer((request, response) => {
  handler(request, response, config).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
server.on('error', error => {
  console.error(`[Error] Cannot listen on ${host}:${port}: ${error.code || 'server error'}`);
  process.exit(1);
});
server.listen(port, host, () => console.log(`ViewRecovery listening at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
