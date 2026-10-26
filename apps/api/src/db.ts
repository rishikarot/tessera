import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
/** Either the pool or a transaction; services accept both. */
export type Db = Sql | Tx;

export function connect(url = process.env.DATABASE_URL ?? 'postgres://tessera:tessera@localhost:5432/tessera'): Sql {
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    transform: { undefined: null },
  });
}
