import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@dropzone/shared';

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, clients: wss.clients.size }));
    return;
  }
  // Static client (production). Guard against path traversal.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(CLIENT_DIST, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(CLIENT_DIST)) { res.writeHead(403); res.end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(CLIENT_DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Client not built. Run `npm run build`.');
  }
});

const wss = new WebSocketServer({ server: http, path: '/ws' });
let nextId = 1;
const send = (ws: WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));

wss.on('connection', (ws) => {
  const id = `p${nextId++}`;
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', message: 'bad json' }); }
    switch (msg.t) {
      case 'hello': return send(ws, { t: 'welcome', id, serverTime: Date.now() });
      case 'ping': return send(ws, { t: 'pong', at: msg.at, serverTime: Date.now() });
    }
  });
});

http.listen(PORT, () => console.log(`[dropzone] http+ws on :${PORT}`));
