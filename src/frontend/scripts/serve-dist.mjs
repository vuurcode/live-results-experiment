// Serves the production build the way the hosting does: static files with gzip, and /api and /ws passed to the backend.
// Used by the perf runs (`playwright.perf.config.ts`), so their numbers are those of the shipped bundle.
// Usage: node scripts/serve-dist.mjs <dist folder> <port> <backend port>
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';

const [root, port, backendPort] = [path.resolve(process.argv[2]), Number(process.argv[3]), Number(process.argv[4])];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml' };
const compressible = new Set(['.js', '.css', '.html', '.txt', '.json', '.svg']);

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    const upstream = http.request({ port: backendPort, path: req.url, method: req.method, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    return req.pipe(upstream);
  }
  let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  // a path outside the build or without a file is a route of the app
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  const ext = path.extname(file);
  const headers = { 'content-type': types[ext] ?? 'application/octet-stream' };
  const body = fs.readFileSync(file);
  if (compressible.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip' });
    return res.end(zlib.gzipSync(body));
  }
  res.writeHead(200, headers);
  res.end(body);
});

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(backendPort, 'localhost', () => {
    const lines = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(port, () => console.log(`serving ${root} on ${port}`));
