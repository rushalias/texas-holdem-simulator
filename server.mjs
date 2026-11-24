import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distFile = path.join(__dirname, 'dist', 'index.html');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 8080;

if (!fs.existsSync(distFile)) {
  console.error(`Missing built bundle at ${distFile}. Run "npm run build" first.`);
  process.exit(1);
}

const indexHtml = fs.readFileSync(distFile, 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(indexHtml);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`Texas Hold'em Simulator Web UI running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
