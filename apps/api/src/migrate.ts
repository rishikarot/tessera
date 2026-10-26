import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, type Sql } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Applies every .sql file in migrations/ that has not run yet, in name order. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(MIGRATIONS_DIR + file, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = connect();
  migrate(sql)
    .then((applied) => console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Database is up to date'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
