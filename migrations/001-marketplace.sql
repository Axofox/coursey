-- Marketplace schema: categories and courses.
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
