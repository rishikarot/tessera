import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
/** Either the pool or a transaction; services accept both. */
export type Db = Sql | Tx;

/**
 * Tessera keeps all of its tables in their own schema, so it can share a
 * database (for example a Supabase project) with other apps without clashing.
 */
export const DB_SCHEMA = process.env.DB_SCHEMA ?? 'tessera';

export function connect(url = process.env.DATABASE_URL ?? 'postgres://tessera:tessera@localhost:5432/tessera'): Sql {
  return postgres(url, {
    connection: { search_path: DB_SCHEMA },
    max: 10,
    // Transaction poolers (such as Supabase on port 6543) do not support prepared statements.
    prepare: !url.includes(':6543'),
    onnotice: () => {},
    transform: { undefined: null },
  });
}
