# Coursehub

A course marketplace built from a design handoff: static frontend, Netlify
Functions API, Postgres on Neon. Accounts, Stripe Checkout, enrolments with
progress and certificates, an instructor studio with a publishing review, and
an admin console — all real, all tested.

**Live:** https://cupcourse.netlify.app · **Repo:** https://github.com/Axofox/coursey · **CI:** `.github/workflows/ci.yml`

| | |
|---|---|
| ![Home](docs/screenshots/home.png) | ![Home, dark](docs/screenshots/home-dark.png) |
| ![Course page](docs/screenshots/course-dark.png) | ![Lesson player](docs/screenshots/lesson.png) |
| ![Admin console](docs/screenshots/admin.png) | ![Course editor](docs/screenshots/editor.png) |

Demo (browse → search → course → cart): [docs/demo.webm](docs/demo.webm)

## What it does

| Area | Status |
|------|--------|
| Catalog: home, search, categories, bundles, course pages, lesson player | **Real** |
| Accounts: sign up / sign in / password reset, sessions, roles (learner · instructor · admin) | **Real** — own implementation, scrypt + httpOnly cookie sessions |
| Checkout: Stripe Checkout, server-side pricing, webhook-created enrolments, free-course enrol | **Real** — needs Stripe keys on the host; a stub runs it locally and in CI |
| Learning: progress per lesson, certificates (public verification page), purchase history, wishlist | **Real** |
| Reviews: signed-in learners submit, admin approves, approved reviews drive the rating | **Real** |
| Instructors: apply → approval → Instructor Studio (own courses, sales, students, reviews) → submit for review → admin publishes | **Real** |
| Admin console: overview, courses (with review queue), categories, bundles, reviews, instructors, learners & roles, payments, reports | **Real** |
| Transactional email: welcome, password reset, purchase receipt, application approved, course published | **Real** via Resend; logged to the function output when no key is set |
| Learner setup (experiment, **UX Foundations only**): pace / practice intensity / goal track chosen on a character-select screen, checkpoints + spaced reviews + track exercises, Sprint streaks and nudges, before/after report | **Real** — per-course flag; see [docs/LEARNER-SETUP.md](docs/LEARNER-SETUP.md) |
| Notifications panel | Empty state only — nothing generates notifications yet |
| Admin → Settings tab | Sample form, not wired |

Video is by link (YouTube / Vimeo / mp4). Non-preview lesson links are only
returned to enrolled learners, owners and admins.

## Repository layout

```
public/                     the site (no build step)
  index.html, course-detail.html, bundle.html, lesson.html, cart.html, checkout-success.html, teach.html
  login.html, signup.html, forgot.html, reset.html, certificate.html
  dashboard.html (learner), seller-dashboard.html (instructor)
  admin-dashboard.html, course-upload.html       admin / instructor tools
  404.html, design/                              error page, style guide + mobile refs
  assets/
    styles.css        design system from the handoff + dark-mode tokens
    site.css          responsive rules and components the handoff lacked
    script.js         handoff interaction layer (theme, tabs, pills, stepper, cart maths)
    theme-boot.js     applies the saved theme before first paint (no inline scripts — see CSP)
    api.js            API client, cart, wishlist, toast, validation, render helpers (window.Coursehub)
    <page>.js         one script per page
netlify/functions/api.mjs   router — createHandler({ query, mailer, stripe }) for tests
netlify/lib/routes/         catalog · auth · reviews+applications · learning · checkout · users
netlify/lib/                auth (scrypt, sessions), stripe (REST + webhook signatures), mail (Resend), http, validate
netlify/lib/db.mjs          pg pool; no DDL at request time
netlify/lib/migrate.mjs     migration runner (also used by tests)
netlify/lib/seed.mjs        starter content matching the design
migrations/NNN-*.sql        versioned schema changes, applied at deploy
scripts/migrate.mjs         `npm run migrate` — the Netlify build command
scripts/dev-server.mjs      `npm run dev` — the real API on an embedded Postgres, Stripe stubbed, mail captured
scripts/screenshots.mjs     regenerates docs/screenshots and docs/demo.webm
test/                       unit tests (no DB) · test/integration (real Postgres)
e2e/                        Playwright specs against the mock server
docs/                       ARCHITECTURE.md · OPERATIONS.md · QA.md · LEARNER-SETUP.md
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data model, request flows,
security), [docs/OPERATIONS.md](docs/OPERATIONS.md) (setup, deploy, migrations,
rollback, backup/restore), [docs/QA.md](docs/QA.md) (test strategy, risk matrix, report).

## Quick start

```bash
npm ci
npm test                 # 69 unit tests, no database
npm run test:integration # 16 tests: migrations + API on a throwaway embedded Postgres
npm run test:e2e         # 41 Playwright tests on the real API (npx playwright install chromium once)
npm run dev              # http://localhost:8765 — real API on an embedded Postgres; first signup becomes admin
```

To run against a real database locally, put `DATABASE_URL` and `ADMIN_TOKEN` in a
gitignored `.env` and use `npx netlify dev` (see OPERATIONS.md).

## Deploy

Push to `main` → Netlify builds: `npm run migrate` applies pending migrations,
then the site and functions go live. Pull requests get a Netlify deploy preview
and must pass CI (unit, integration, e2e, dependency + secret scan).

## Environment variables

| Name | Required | Purpose |
|------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string (Neon, pooled) |
| `ADMIN_TOKEN` | recommended | Break-glass admin access and bootstrap: a signup sent with this Bearer token becomes an admin. Otherwise the **first** account is the admin. |
| `STRIPE_SECRET_KEY` | for paid checkout | `sk_test_…` / `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | for paid checkout | signing secret of the webhook pointed at `/api/stripe/webhook` |
| `RESEND_API_KEY`, `MAIL_FROM` | for email | without them, emails are logged instead of sent |
| `SITE_URL` | recommended | absolute origin used in emails and Stripe redirects (defaults to the request origin) |
