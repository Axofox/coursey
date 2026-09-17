/*
  Database access.

  Plain Postgres via the standard `pg` driver. The connection string comes from
  DATABASE_URL (works with any Postgres host: Neon, Supabase, Railway,
  self-hosted...). Changing hosts means changing that one variable.
*/
import pg from "pg";
import { SEED_CATEGORIES, SEED_COURSES } from "./seed.mjs";

let pool;
let schemaReady;

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("No database configured: set the DATABASE_URL environment variable.");
}

async function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

/*
  Schema version 2 — the Coursehub marketplace model.
  Version 1 was the early mockup (categories + bare courses) and only ever
  held placeholder seed data, so upgrading drops it and reseeds.
*/
const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon_bg     TEXT NOT NULL DEFAULT '#EDEBFB',
    icon_color  TEXT NOT NULL DEFAULT '#7A6DF0',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS courses (
    id               SERIAL PRIMARY KEY,
    category_id      TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title            TEXT NOT NULL,
    subtitle         TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    instructor_name  TEXT NOT NULL DEFAULT '',
    instructor_title TEXT NOT NULL DEFAULT '',
    instructor_bio   TEXT NOT NULL DEFAULT '',
    level            TEXT NOT NULL DEFAULT 'Beginner',
    language         TEXT NOT NULL DEFAULT 'English',
    price            NUMERIC(10,2) NOT NULL DEFAULT 0,
    original_price   NUMERIC(10,2),
    badge            TEXT,
    rating           NUMERIC(2,1) NOT NULL DEFAULT 0,
    rating_count     INTEGER NOT NULL DEFAULT 0,
    students         INTEGER NOT NULL DEFAULT 0,
    resources        INTEGER NOT NULL DEFAULT 0,
    learn            JSONB NOT NULL DEFAULT '[]',
    requirements     JSONB NOT NULL DEFAULT '[]',
    curriculum       JSONB NOT NULL DEFAULT '[]',
    featured         BOOLEAN NOT NULL DEFAULT false,
    published        BOOLEAN NOT NULL DEFAULT true,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS courses_category_idx ON courses(category_id);
`;

async function currentVersion(p) {
  const { rows } = await p.query(
    "SELECT to_regclass('public.meta') IS NOT NULL AS has_meta, to_regclass('public.courses') IS NOT NULL AS has_courses"
  );
  if (!rows[0].has_meta) return rows[0].has_courses ? 1 : 0;
  const v = await p.query("SELECT value FROM meta WHERE key = 'schema_version'");
  return v.rows[0] ? Number(v.rows[0].value) : 1;
}

async function seed(p) {
  for (const [i, c] of SEED_CATEGORIES.entries()) {
    await p.query(
      "INSERT INTO categories (id, name, description, icon_bg, icon_color, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
      [c.id, c.name, c.description, c.icon_bg, c.icon_color, i]
    );
  }
  for (const [i, c] of SEED_COURSES.entries()) {
    await p.query(
      `INSERT INTO courses (category_id, title, subtitle, description, instructor_name, instructor_title,
         instructor_bio, level, language, price, original_price, badge, rating, rating_count, students,
         resources, learn, requirements, curriculum, featured, published, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21)`,
      [c.category_id, c.title, c.subtitle, c.description, c.instructor_name, c.instructor_title,
       c.instructor_bio, c.level, c.language || "English", c.price, c.original_price ?? null, c.badge ?? null,
       c.rating, c.rating_count, c.students, c.resources || 0, JSON.stringify(c.learn || []),
       JSON.stringify(c.requirements || []), JSON.stringify(c.curriculum || []), !!c.featured, i]
    );
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = await getPool();
      const version = await currentVersion(p);
      if (version < SCHEMA_VERSION) {
        if (version === 1) await p.query("DROP TABLE IF EXISTS courses; DROP TABLE IF EXISTS categories;");
        await p.query(SCHEMA);
        const { rows } = await p.query("SELECT count(*)::int AS n FROM categories");
        if (rows[0].n === 0) await seed(p);
        await p.query(
          "INSERT INTO meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [String(SCHEMA_VERSION)]
        );
      }
    })().catch((e) => {
      schemaReady = null; // let the next request retry
      throw e;
    });
  }
  return schemaReady;
}

export async function query(text, params) {
  await ensureSchema();
  const p = await getPool();
  return p.query(text, params);
}
