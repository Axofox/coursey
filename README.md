# Coursehub

Course marketplace built from the Coursehub design handoff. Static frontend,
Netlify Functions API, Postgres on Neon.

Live: https://cupcourse.netlify.app · Repo: https://github.com/Axofox/coursey

## What's real vs. preview

| Page | Status |
|------|--------|
| `index.html` — home & catalog | **Real.** Categories, featured grid, search (`?q=`), category filter (`?category=`), bundles, stats — all from the database. Wishlist hearts persist in the browser. |
| `course-detail.html?id=N` | **Real.** Everything comes from the course record, incl. approved reviews. Add-to-cart (browser cart), review form (moderated), "Preview this course" → lesson player. |
| `bundle.html?id=N` | **Real.** Bundle contents, savings, add-to-cart. |
| `lesson.html?course=N&s=0&l=0` | **Real.** Video player (YouTube / Vimeo / mp4 links) with curriculum sidebar and local progress. Only lessons flagged *Free preview* (or any lesson of a free course) play until purchases exist. |
| `teach.html` | **Real.** Instructor application form → admin Instructors tab. |
| `cart.html` | **Half.** Real courses/bundles from the browser cart, live totals, validated card form. "Pay" is not connected to a payment provider — nothing is charged. |
| `admin-dashboard.html` | **Real** for Overview, Courses, Categories, Bundles, Reviews (moderation), Instructors (applications) and Reports (catalog analytics). Learners, Payments and Settings show sample data, labelled as such. Sign in with `ADMIN_TOKEN`. |
| `course-upload.html` | **Real.** 4-step editor with inline validation; lessons can carry a video link and a free-preview flag. `?id=N` edits. |
| `dashboard.html` | **Preview**, except the Wishlist tab which is real (browser wishlist). |
| `seller-dashboard.html` | **Preview** — needs instructor accounts. |
| `404.html` | Served by Netlify for unknown paths. |
| `design/` | The style guide and mobile reference screens from the handoff, unchanged. |

Still needs accounts (next phase): sign-up/login/password reset, purchases and
enrolments, certificates, instructor self-service, real notifications.

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
    home.js / course.js / bundle.js / lesson.js / cart.js / teach.js / dashboard.js / admin.js / editor.js   one per page
  bundle.html, lesson.html, teach.html, 404.html
netlify/functions/api.mjs   JSON API (Functions v2), routes /api/*; `createHandler({ query })` for tests
netlify/lib/db.mjs          Postgres via `pg`, schema + migration + first-run seed
netlify/lib/seed.mjs        starter content matching the design
scripts/mock-server.mjs     `npm run mock` — frontend against an in-memory API (token "testtoken")
test/                       `npm test` — Node's built-in runner; API routing/validation, seed integrity, browser helpers
netlify.toml                publish dir, bundler, /home.html → / redirect
```

## Data model

- **categories** — `id` (slug), `name`, `description`, `icon_bg`, `icon_color`, `sort_order`
- **courses** — `category_id`, `title`, `subtitle`, `description`, `instructor_name/title/bio`,
  `level` (Beginner/Intermediate/Advanced), `language`, `price`, `original_price`, `badge`
  (Bestseller/New/null), `rating`, `rating_count`, `students`, `resources`,
  `learn[]`, `requirements[]`, `curriculum[{title, lessons[{title, duration "m:ss", video_url, preview}]}]`,
  `featured`, `published`, `updated_at`
- **bundles** — `name`, `description`, `price`, `course_ids[]`, `published`
- **reviews** — `course_id`, `name`, `rating` 1–5, `body`, `status` pending/approved. A course with
  approved reviews shows their average instead of the manual `rating`.
- **instructor_applications** — `name`, `email`, `expertise`, `bio`, `portfolio_url`, `status` new/approved/rejected

The schema is created on the first request and versioned in a `meta` table.
Version 1 (the old mockup) is dropped and reseeded automatically.

## API

Public: `GET /api/categories`, `GET /api/courses[?category=&q=&featured=1]`,
`GET /api/courses/:id`, `GET /api/bundles[/:id]`, `GET /api/stats`,
`POST /api/reviews`, `POST /api/applications` (both with a honeypot `website` field).

Admin (`Authorization: Bearer <ADMIN_TOKEN>`): `GET /api/auth/check`, `?all=1` on
courses/bundles, `POST/PUT/DELETE` on courses, categories, bundles; `GET/PUT/DELETE`
on reviews and applications. The full route list is at the top of `api.mjs`.

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
