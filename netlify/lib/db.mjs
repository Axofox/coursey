/*
  Database access for the API.

  Plain Postgres via the standard `pg` driver. The connection string comes from
  DATABASE_URL (works with any Postgres host: Neon, Supabase, Railway,
  self-hosted...). Changing hosts means changing that one variable.

  The schema is managed by migrations/ and applied at deploy time
  (scripts/migrate.mjs) — nothing here alters tables at request time.
*/
import pg from "pg";

let pool;

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("No database configured: set the DATABASE_URL environment variable.");
}

function getPool() {
  if (!pool) {
    const url = connectionString();
    pool = new pg.Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}
