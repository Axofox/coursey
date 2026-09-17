/*
  Database access.

  Plain Postgres via the standard `pg` driver. The connection string comes from
  DATABASE_URL (works with any Postgres host: Neon, Supabase, Railway,
  self-hosted...). Changing hosts means changing that one variable.
*/
import pg from "pg";
import { SEED_CATEGORIES, SEED_COURSES, SEED_BUNDLES } from "./seed.mjs";

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
  Schema versions:
    1  the early mockup (categories + bare courses) — only ever held seed data,
       so upgrading drops it and reseeds
    2  the Coursehub marketplace model (categories, courses)
    3  adds bundles, reviews (moderated) and instructor applications
  SCHEMA is idempotent, so upgrading just re-runs it.
*/
const SCHEMA_VERSION = 3;

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
  CREATE TABLE IF NOT EXISTS bundles (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    price          NUMERIC(10,2) NOT NULL DEFAULT 0,
    course_ids     JSONB NOT NULL DEFAULT '[]',
    published      BOOLEAN NOT NULL DEFAULT true,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id          SERIAL PRIMARY KEY,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS reviews_course_idx ON reviews(course_id, status);
  CREATE TABLE IF NOT EXISTS instructor_applications (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    expertise     TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    portfolio_url TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
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
      [c.category_id, c.title, c.subtitle ?? "", c.description ?? "", c.instructor_name ?? "", c.instructor_title ?? "",
       c.instructor_bio ?? "", c.level ?? "Beginner", c.language ?? "English", c.price ?? 0, c.original_price ?? null, c.badge ?? null,
       c.rating ?? 0, c.rating_count ?? 0, c.students ?? 0, c.resources ?? 0, JSON.stringify(c.learn ?? []),
       JSON.stringify(c.requirements ?? []), JSON.stringify(c.curriculum ?? []), !!c.featured, i]
    );
  }
}

// Bundles reference courses by title so this also works on a database that
// already had the courses seeded.
async function seedBundles(p) {
  const { rows } = await p.query("SELECT id, title FROM courses");
  const idByTitle = new Map(rows.map((r) => [r.title, r.id]));
  for (const [i, b] of SEED_BUNDLES.entries()) {
    const ids = b.courses.map((t) => idByTitle.get(t)).filter(Boolean);
    if (!ids.length) continue;
    await p.query(
      "INSERT INTO bundles (name, description, price, course_ids, sort_order) VALUES ($1,$2,$3,$4,$5)",
      [b.name, b.description, b.price, JSON.stringify(ids), i]
    );
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await (await getPool()).connect();
      try {
        // One transaction, so a failed migration leaves the previous state untouched
        await client.query("BEGIN");
        const version = await currentVersion(client);
        if (version < SCHEMA_VERSION) {
          if (version === 1) await client.query("DROP TABLE IF EXISTS courses; DROP TABLE IF EXISTS categories;");
          await client.query(SCHEMA);
          const { rows } = await client.query("SELECT count(*)::int AS n FROM categories");
          if (rows[0].n === 0) await seed(client);
          const bundles = await client.query("SELECT count(*)::int AS n FROM bundles");
          if (bundles.rows[0].n === 0) await seedBundles(client);
          await client.query(
            "INSERT INTO meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            [String(SCHEMA_VERSION)]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
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
