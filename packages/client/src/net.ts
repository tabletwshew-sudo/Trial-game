import type { AuthResponse, ClientMsg, ServerMsg, UserView } from '@dropzone/shared';

const TOKEN_KEY = 'dz.token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: 'Server unreachable' }));
  if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
  return data as T;
}

export const auth = {
  async register(name: string, password: string) { const r = await post<AuthResponse>('/api/register', { name, password }); setToken(r.token); return r.user; },
  async login(name: string, password: string) { const r = await post<AuthResponse>('/api/login', { name, password }); setToken(r.token); return r.user; },
  async guest() { const r = await post<AuthResponse>('/api/guest', {}); setToken(r.token); return r.user; },
  async me(): Promise<UserView | null> {
    const token = getToken();
    if (!token) return null;
    const r = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!r) throw new Error('Server unreachable');
    if (r.status === 401) { setToken(null); return null; }
    return (await r.json()).user;
  },
  async logout() { const token = getToken(); setToken(null); if (token) await post('/api/logout', { token }).catch(() => {}); },
};

type Handler = (m: ServerMsg) => void;

/** Lobby socket with automatic reconnect (exponential backoff). */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private retry = 0;
  private closed = false;
  onStatus?: (s: 'online' | 'reconnecting' | 'signed_out') => void;

  connect() {
    const token = getToken();
    if (!token) return this.onStatus?.('signed_out');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      if (m.t === 'welcome') { this.retry = 0; this.onStatus?.('online'); }
      this.handlers.forEach((h) => h(m));
    };
    ws.onclose = (e) => {
      if (this.closed) return;
      if (e.code === 4001) { setToken(null); return this.onStatus?.('signed_out'); }
      this.onStatus?.('reconnecting');
      setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }
  on(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.closed = true; this.ws?.close(); }
}
