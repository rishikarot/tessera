import { buildApp } from './app.js';
import { connect } from './db.js';
import { migrate } from './migrate.js';

const sql = connect();
await migrate(sql);
const app = buildApp(sql, { logger: true });
const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
