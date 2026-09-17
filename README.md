# Coursehub

Course marketplace built from the Coursehub design handoff. Static frontend,
Netlify Functions API, Postgres on Neon.

Live: https://cupcourse.netlify.app · Repo: https://github.com/Axofox/coursey

## What's real vs. preview

| Page | Status |
|------|--------|
| `index.html` — home & catalog | **Real.** Categories, featured grid, search (`?q=`), category filter (`?category=`), stats — all from the database. Bundles section is a placeholder ("Coming soon"). |
| `course-detail.html?id=N` | **Real.** Everything on the page comes from the course record. Add-to-cart works (browser cart). |
| `cart.html` | **Half.** Shows the real courses you added (stored in this browser) with live totals. "Pay" is not connected to a payment provider. |
| `admin-dashboard.html` | **Real** for Courses and Categories (sign in with `ADMIN_TOKEN`). Overview, Instructors, Learners, Payments, Reports and Settings show sample data, labelled as such. |
| `course-upload.html` | **Real.** The 4-step editor creates and edits courses (`?id=N` to edit). Requires the admin token. |
| `dashboard.html`, `seller-dashboard.html` | **Preview** — need user accounts, which don't exist yet. Banner says so. |
| `design/` | The style guide and mobile reference screens from the handoff, unchanged. |

Next phase, when wanted: user accounts (sign-up/login), Stripe checkout, and
instructor self-service — the seller dashboard and learner dashboard designs
are already in place for it.

## Layout

```
public/
  index.html, course-detail.html, cart.html      marketplace
  admin-dashboard.html, course-upload.html       admin (token-gated)
  dashboard.html, seller-dashboard.html          previews
  design/                                        style guide + mobile refs
  assets/
    styles.css     design system from the handoff (untouched)
    site.css       responsive rules + admin/editor components
    script.js      handoff's interaction layer (theme, tabs, accordions, stepper, cart maths)
    api.js         API client, browser cart, shared render helpers  (window.Coursehub)
    home.js / course.js / cart.js / admin.js / editor.js   one per page
netlify/functions/api.mjs   JSON API (Functions v2), routes /api/*
netlify/lib/db.mjs          Postgres via `pg`, schema + migration + first-run seed
netlify/lib/seed.mjs        starter content matching the design
netlify.toml                publish dir, bundler, /home.html → / redirect
```

## Data model

- **categories** — `id` (slug), `name`, `description`, `icon_bg`, `icon_color`, `sort_order`
- **courses** — `category_id`, `title`, `subtitle`, `description`, `instructor_name/title/bio`,
  `level` (Beginner/Intermediate/Advanced), `language`, `price`, `original_price`, `badge`
  (Bestseller/New/null), `rating`, `rating_count`, `students`, `resources`,
  `learn[]`, `requirements[]`, `curriculum[{title, lessons[{title, duration "m:ss"}]}]`,
  `featured`, `published`, `updated_at`

The schema is created on the first request and versioned in a `meta` table.
Version 1 (the old mockup) is dropped and reseeded automatically.

## API

Public: `GET /api/categories`, `GET /api/courses[?category=&q=&featured=1]`,
`GET /api/courses/:id`, `GET /api/stats`.

Admin (`Authorization: Bearer <ADMIN_TOKEN>`): `GET /api/auth/check`,
`GET /api/courses?all=1`, `POST/PUT/DELETE /api/courses[/:id]`,
`POST/PUT/DELETE /api/categories[/:id]`. Field validation lives in
`COURSE_FIELDS` in `api.mjs`.

## Environment variables (Netlify → Site configuration → Environment variables)

| Name           | Purpose                                            |
|----------------|----------------------------------------------------|
| `DATABASE_URL` | Postgres connection string (Neon, pooled)          |
| `ADMIN_TOKEN`  | required for all write endpoints and the admin UI  |

Locally, both go in the gitignored `.env`.

## Local development

`npx netlify dev` serves `public/` plus the functions on http://localhost:8888
(reads `.env`; after `npx netlify login` + `npx netlify link` it also pulls
the site's env vars). There is also a `.claude/launch.json` "mock" config
that serves the frontend against an in-memory API for UI work without a
database.

## Deploy

Push to `main` — Netlify deploys automatically from GitHub.
