/** WebSocket message envelopes. Expanded each phase. */
export type ClientMsg =
  | { t: 'hello'; token?: string; name: string }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'error'; message: string };

export const PROTOCOL_VERSION = 1;
