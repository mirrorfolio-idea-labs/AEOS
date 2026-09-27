// A static server for the assembled Pages tree, mounted under the site base,
// shared by verify-site.mjs and lighthouse.mjs.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.sh': 'text/plain', '.xml': 'application/xml', '.txt': 'text/plain' };

export function fileFor(root, base, urlPath) {
  if (!urlPath.startsWith(base)) return undefined;
  const p = path.join(root, decodeURIComponent(urlPath.slice(base.length)));
  for (const c of [p, path.join(p, 'index.html')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
}

/** Starts the server; resolves to { origin, close }. */
export async function serve(root, base) {
  const server = http.createServer((req, res) => {
    const file = fileFor(root, base, new URL(req.url, 'http://x').pathname);
    if (file === undefined) return void res.writeHead(404).end();
    res
      .writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' })
      .end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
