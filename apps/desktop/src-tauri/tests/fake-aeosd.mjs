// Stand-in daemon for lifecycle tests: serves /v1/health, exits 0 on SIGTERM
// and writes a marker so the test can prove a *clean* shutdown.
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.env.AEOS_PORT);
const marker = process.env.FAKE_MARKER;
const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/v1/health' ? 200 : 404, { 'content-type': 'application/json' });
  res.end('{"success":true}');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => {
  fs.writeFileSync(marker, 'stopped-cleanly');
  server.close(() => process.exit(0));
});
