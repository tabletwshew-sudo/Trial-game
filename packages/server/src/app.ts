import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { MIN_PASSWORD, NAME_RE, PROTOCOL_VERSION, type AuthResponse, type ClientMsg, type ServerMsg } from '@dropzone/shared';
import { Store, type UserRecord } from './store.js';
import { Hub } from './hub.js';

export interface AppOptions {
  port: number;
  dataFile: string | null;
  clientDist: string;
  queueTimeoutS: number;
  disconnectGraceMs: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

export function createApp(opts: AppOptions) {
  const store = new Store(opts.dataFile);
  const hub = new Hub(store, { queueTimeoutS: opts.queueTimeoutS, disconnectGraceMs: opts.disconnectGraceMs });
  const clientDist = resolve(opts.clientDist);

  // naive per-IP limiter for auth endpoints: 20 attempts / minute
  const hits = new Map<string, { n: number; at: number }>();
  const limited = (ip: string) => {
    const now = Date.now(), h = hits.get(ip);
    if (!h || now - h.at > 60_000) { hits.set(ip, { n: 1, at: now }); return false; }
    return ++h.n > 20;
  };

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<any>((ok) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 4096) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(data || '{}')); } catch { ok({}); } });
  });
  const authOk = (u: UserRecord): AuthResponse => ({ token: store.createSession(u.id), user: { id: u.id, name: u.name, guest: u.guest } });

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = req.socket.remoteAddress ?? '?';
    if (req.method !== 'POST' && path !== '/api/me') return json(res, 405, { error: 'POST only' });
    if (path === '/api/me') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const u = store.userForToken(token);
      return u ? json(res, 200, { user: { id: u.id, name: u.name, guest: u.guest } }) : json(res, 401, { error: 'Signed out' });
    }
    if (limited(ip)) return json(res, 429, { error: 'Too many attempts, wait a minute' });
    const body = await readBody(req);
    const name = String(body.name ?? '').trim();
    const password = String(body.password ?? '');

    if (path === '/api/register') {
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Name must be 3-16 letters, numbers or _' });
      if (password.length < MIN_PASSWORD) return json(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
      if (store.findByName(name)) return json(res, 409, { error: 'That name is taken' });
      return json(res, 200, authOk(store.createUser(name, password, false)));
    }
    if (path === '/api/login') {
      const u = store.findByName(name);
      if (!u || !store.checkPassword(u, password)) return json(res, 401, { error: 'Wrong name or password' });
      return json(res, 200, authOk(u));
    }
    if (path === '/api/guest') {
      let guestName = '';
      for (let i = 0; i < 20 && (!guestName || store.findByName(guestName)); i++) guestName = `Guest${randomInt(10000, 99999)}`;
      return json(res, 200, authOk(store.createUser(guestName, null, true)));
    }
    if (path === '/api/logout') {
      store.deleteSession(String(body.token ?? ''));
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  async function serveStatic(res: ServerResponse, pathname: string) {
    const rel = normalize(decodeURIComponent(pathname));
    let file = join(clientDist, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(clientDist)) { res.writeHead(403); res.end(); return; }
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(clientDist, 'index.html'); }
    try {
      const body = await readFile(file);
      const cache = file.includes(`${'/'}assets${'/'}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
      res.end(body);
    } catch { res.writeHead(404); res.end('Client not built. Run `npm run build`.'); }
  }

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION, online: wss.clients.size, matches: hub.matches.size });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
      return await serveStatic(res, url.pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
    }
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws: WebSocket) => {
    let userId: string | null = null;
    let send: ((m: ServerMsg) => void) | null = null;
    let budget = 40; // messages per second
    const refill = setInterval(() => (budget = 40), 1000);
    const authTimeout = setTimeout(() => !userId && ws.close(4001, 'auth timeout'), 10_000);

    ws.on('message', (raw) => {
      if (--budget < 0) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!userId) {
        if (msg?.t !== 'hello') return;
        const u = store.userForToken(String(msg.token));
        if (!u) { ws.send(JSON.stringify({ t: 'error', message: 'Signed out' } satisfies ServerMsg)); return ws.close(4001, 'bad token'); }
        userId = u.id;
        clearTimeout(authTimeout);
        send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
        hub.connect(u, send);
        return;
      }
      hub.handle(userId, msg);
    });
    ws.on('close', () => {
      clearInterval(refill); clearTimeout(authTimeout);
      if (userId && send) hub.disconnect(userId, send);
    });
  });

  const ticker = setInterval(() => hub.tick(), 1000);

  return {
    http, hub, store,
    listen: () => new Promise<number>((ok) => http.listen(opts.port, () => ok((http.address() as any).port))),
    close: () => new Promise<void>((ok) => { clearInterval(ticker); store.flush(); wss.close(); http.close(() => ok()); for (const c of wss.clients) c.terminate(); }),
  };
}
