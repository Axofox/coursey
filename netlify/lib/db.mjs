/*
  Database access.

  Plain Postgres via the standard `pg` driver. The connection string comes from
  DATABASE_URL if set (works with any Postgres host: Neon, Supabase, Railway,
  self-hosted...), otherwise from Netlify Database. Migrating off Netlify means
  setting DATABASE_URL — nothing else changes.
*/
import pg from "pg";

let pool;
let schemaReady;

async function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const { getConnectionString } = await import("@netlify/database");
    const url = getConnectionString();
    if (url) return url;
  } catch (e) {
    /* package not configured — fall through */
  }
  throw new Error("No database configured: set DATABASE_URL or enable Netlify Database.");
}

async function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: await connectionString(),
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS courses (
    id          SERIAL PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    level       TEXT NOT NULL DEFAULT 'Beginner',
    lessons     INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS courses_category_idx ON courses(category_id);
`;

// Same placeholder content the mockup shipped with, so the site isn't empty
// the first time it comes up.
const SEED = [
  {
    id: "personal-development",
    name: "Personal Development",
    description: "Habits, focus, and growth-oriented courses.",
    courses: [
      { title: "Building Daily Discipline", level: "Beginner", lessons: 8 },
      { title: "Deep Work Fundamentals", level: "Intermediate", lessons: 6 },
    ],
  },
  {
    id: "positivity",
    name: "Positivity",
    description: "Mindset, resilience, and everyday optimism.",
    courses: [
      { title: "Reframing Negative Thoughts", level: "Beginner", lessons: 5 },
      { title: "Gratitude in Practice", level: "Beginner", lessons: 4 },
    ],
  },
  {
    id: "ai",
    name: "AI",
    description: "Practical AI skills, no heavy math required.",
    courses: [
      { title: "AI Tools for Everyday Work", level: "Beginner", lessons: 7 },
      { title: "Prompting Well", level: "Intermediate", lessons: 5 },
    ],
  },
];

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = await getPool();
      await p.query(SCHEMA);
      const { rows } = await p.query("SELECT count(*)::int AS n FROM categories");
      if (rows[0].n === 0) {
        for (const [ci, cat] of SEED.entries()) {
          await p.query(
            "INSERT INTO categories (id, name, description, sort_order) VALUES ($1,$2,$3,$4)",
            [cat.id, cat.name, cat.description, ci]
          );
          for (const [i, c] of cat.courses.entries()) {
            await p.query(
              "INSERT INTO courses (category_id, title, level, lessons, sort_order) VALUES ($1,$2,$3,$4,$5)",
              [cat.id, c.title, c.level, c.lessons, i]
            );
          }
        }
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
