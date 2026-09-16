# Course Site

Course catalogue site: homepage with categories, category/course listing
pages, and a token-protected admin screen. Light/dark mode, responsive.

Live: https://cupcourse.netlify.app · Repo: https://github.com/Axofox/coursey

## How it's built

```
public/                    static frontend (no build step)
  index.html               homepage — category grid
  category.html            one category + its courses (?id=slug)
  admin.html               admin — sign in with ADMIN_TOKEN, manage content
  api.js                   fetch wrapper for the API
  admin.js                 admin page logic
  script.js                theme, nav, public page rendering
netlify/functions/api.mjs  JSON API (Netlify Functions v2), routes /api/*
netlify/lib/db.mjs         Postgres access, schema + first-run seed data
netlify.toml               publish dir, function bundler settings
```

- **Database:** Postgres on Neon (free tier), connected via `DATABASE_URL`.
  The schema is created automatically on the first request and seeded with
  the three starter categories if empty.
- **Auth:** reads are public; every write requires
  `Authorization: Bearer <ADMIN_TOKEN>`. The token is an environment
  variable on Netlify (and in the gitignored `.env` locally).
- **Portability:** standard `pg` driver, plain SQL, standard web
  Request/Response handlers. To move hosts: `pg_dump` → `pg_restore`,
  set `DATABASE_URL`, done.

## API

| Method | Path                    | Auth  | Body                                                    |
|--------|-------------------------|-------|---------------------------------------------------------|
| GET    | /api/categories         | —     |                                                         |
| GET    | /api/categories/:id     | —     |                                                         |
| POST   | /api/categories         | token | `{ name, description }`                                 |
| PUT    | /api/categories/:id     | token | `{ name?, description? }`                               |
| DELETE | /api/categories/:id     | token | (also deletes its courses)                              |
| POST   | /api/courses            | token | `{ category_id, title, description?, level?, lessons? }`|
| PUT    | /api/courses/:id        | token | `{ title?, description?, level?, lessons? }`            |
| DELETE | /api/courses/:id        | token |                                                         |
| GET    | /api/auth/check         | token | 204 if the token is valid                               |

`level` is one of `Beginner`, `Intermediate`, `Advanced`.

## Environment variables

| Name           | Where                    | Purpose                                  |
|----------------|--------------------------|------------------------------------------|
| `ADMIN_TOKEN`  | Netlify env vars, `.env` | required for all write endpoints         |
| `DATABASE_URL` | Netlify env vars, `.env` | Postgres connection string (from Neon)   |

## Local development

```bash
npx netlify login      # once
npx netlify link       # once — pick the cupcourse site
npx netlify dev        # serves public/ + functions on http://localhost:8888
```

`netlify dev` pulls the site's environment variables automatically, and
also reads `.env`.

## Deploy

Push to `main` — Netlify deploys automatically from GitHub.
