import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WARMUP_S } from '@dropzone/shared';
import { createApp } from './app.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = createApp({
  port: Number(process.env.PORT ?? 8080),
  dataFile: process.env.DATA_FILE ?? resolve(here, '../../../data/db.json'),
  clientDist: resolve(here, '../../client/dist'),
  queueTimeoutS: Number(process.env.QUEUE_TIMEOUT_S ?? 30),
  disconnectGraceMs: 20_000,
  warmupS: Number(process.env.WARMUP_S ?? WARMUP_S),
});
app.listen().then((port) => console.log(`[dropzone] http+ws on :${port}`));
const shutdown = () => app.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
