import { config } from './config.js';
import { openDb, sql } from './db/db.js';
import { createApp } from './app.js';
import { deliverPending } from './services/webhooks.js';
import { runRetention } from './services/retention.js';

openDb();
const app = createApp();
app.listen(config.port, () => {
  console.log(`Ortho Monitoring AI API listening on http://localhost:${config.port}`);
});

// Background workers (a queue such as BullMQ/SQS replaces these timers in production).
setInterval(() => { deliverPending().catch((e) => console.error('webhook worker', e)); }, 30_000);
setInterval(() => {
  for (const t of sql.all<{ id: string }>('SELECT id FROM tenants')) runRetention(t.id);
}, 24 * 3600_000);
