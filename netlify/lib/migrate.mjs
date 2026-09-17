/*
  Migration runner. Applies every migrations/NNN-*.sql that isn't recorded in
  schema_migrations, each inside its own transaction, then seeds starter
  content if the catalog is empty. Never drops or rewrites existing tables —
  destructive changes need an explicit, reviewed migration.

  Run as a deployment step (`npm run migrate`, see netlify.toml) and locally
  against any Postgres via DATABASE_URL. Safe to run repeatedly.
*/
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_CATEGORIES, SEED_COURSES, SEED_BUNDLES } from "./seed.mjs";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

// Databases set up by the pre-migration-file code recorded a single version
// number in `meta`. Map it to the migrations that version already contained.
const LEGACY_VERSION_COVERS = { 2: ["001-marketplace.sql"], 3: ["001-marketplace.sql", "002-bundles-reviews-applications.sql"] };

async function listMigrations() {
  const names = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}-.*\.sql$/.test(f)).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await fs.readFile(path.join(MIGRATIONS_DIR, name), "utf8") })));
}

async function bootstrap(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const { rows } = await client.query("SELECT to_regclass('public.meta') IS NOT NULL AS has_meta");
  if (!rows[0].has_meta) return;
  const v = await client.query("SELECT value FROM meta WHERE key = 'schema_version'");
  const covered = LEGACY_VERSION_COVERS[Number(v.rows[0]?.value)] || [];
  for (const name of covered) {
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
  }
}

export async function seedIfEmpty(client, log = () => {}) {
  const { rows } = await client.query("SELECT count(*)::int AS n FROM categories");
  if (rows[0].n === 0) {
    log("Catalog is empty — seeding starter content");
    for (const [i, c] of SEED_CATEGORIES.entries()) {
      await client.query(
        "INSERT INTO categories (id, name, description, icon_bg, icon_color, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
        [c.id, c.name, c.description, c.icon_bg, c.icon_color, i]
      );
    }
    for (const [i, c] of SEED_COURSES.entries()) {
      await client.query(
        `INSERT INTO courses (category_id, title, subtitle, description, instructor_name, instructor_title,
           instructor_bio, level, language, price, original_price, badge, rating, rating_count, students,
           resources, learn, requirements, curriculum, featured, published, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21)`,
        [c.category_id, c.title, c.subtitle ?? "", c.description ?? "", c.instructor_name ?? "", c.instructor_title ?? "",
         c.instructor_bio ?? "", c.level ?? "Beginner", c.language ?? "English", c.price ?? 0, c.original_price ?? null, c.badge ?? null,
         c.rating ?? 0, c.rating_count ?? 0, c.students ?? 0, c.resources ?? 0, JSON.stringify(c.learn ?? []),
         JSON.stringify(c.requirements ?? []), JSON.stringify(c.curriculum ?? []), !!c.featured, i]
      );
    }
  }
  const bundles = await client.query("SELECT count(*)::int AS n FROM bundles");
  if (bundles.rows[0].n === 0) {
    // Bundles reference courses by title so this also works on a database that already had courses.
    const { rows: courses } = await client.query("SELECT id, title FROM courses");
    const idByTitle = new Map(courses.map((r) => [r.title, r.id]));
    for (const [i, b] of SEED_BUNDLES.entries()) {
      const ids = b.courses.map((t) => idByTitle.get(t)).filter(Boolean);
      if (ids.length < 2) continue;
      await client.query(
        "INSERT INTO bundles (name, description, price, course_ids, sort_order) VALUES ($1,$2,$3,$4,$5)",
        [b.name, b.description, b.price, JSON.stringify(ids), i]
      );
    }
  }
}

/* Returns the names of migrations applied in this run. */
export async function migrate(pool, { log = () => {}, seed = true } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727271)"); // one runner at a time
    await bootstrap(client);
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const m of await listMigrations()) {
      if (done.has(m.name)) continue;
      log(`Applying ${m.name}`);
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
      applied.push(m.name);
    }
    if (seed) await seedIfEmpty(client, log);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return applied;
}
