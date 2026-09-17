// Deployment step: apply pending migrations to DATABASE_URL. Exits non-zero
// on failure so a broken migration fails the deploy instead of the site.
import pg from "pg";
import { migrate } from "../netlify/lib/migrate.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — refusing to deploy without a database.");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 1 });
try {
  const applied = await migrate(pool, { log: (m) => console.log("[migrate]", m) });
  console.log(applied.length ? `[migrate] Applied ${applied.length} migration(s): ${applied.join(", ")}` : "[migrate] Database is up to date");
} catch (e) {
  console.error("[migrate] FAILED:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
