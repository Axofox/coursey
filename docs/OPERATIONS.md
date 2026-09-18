# Operations

## Local setup

```bash
git clone git@github.com:Axofox/coursey.git && cd coursey
npm ci
```

Three ways to run it, from lightest to most realistic:

| Command | What you get | Needs |
|---------|--------------|-------|
| `npm run dev` | The real API + frontend at http://localhost:8765 on a throwaway embedded Postgres. Stripe is stubbed (checkout "pays" instantly), emails are captured at `/__test/mail`. First signup is admin; admin token `testtoken`. | nothing |
| `npm run test:integration` | Migrations + API against a throwaway embedded Postgres | nothing (downloads a Postgres binary on first run) |
| `npx netlify dev` | The real function + your own database at http://localhost:8888 | `.env` with `DATABASE_URL` and `ADMIN_TOKEN` |

`.env` is gitignored. Generate a token with `openssl rand -hex 24`.

## Test data

- A fresh database is seeded by the migration step with the catalog from
  `netlify/lib/seed.mjs` (6 categories, 8 courses, 3 bundles). Seeding only
  happens when `categories` is empty, so it never touches a live catalog.
- The dev server and the e2e tests use the same seed; accounts are created per test.
- Integration tests create their own rows and clean up; they never run
  against `DATABASE_URL` unless you set it explicitly (CI points it at a
  service container).

## Environment variables

| Name | Set in | Notes |
|------|--------|-------|
| `DATABASE_URL` | Netlify env vars (all scopes), `.env` | Neon **pooled** connection string. Needed at build time for migrations and at runtime for the function. |
| `ADMIN_TOKEN` | Netlify env vars, `.env` | Break-glass admin + bootstrap. Once an admin account exists you can unset it. |
| `STRIPE_SECRET_KEY` | Netlify env vars | From Stripe → Developers → API keys. Test keys until launch. |
| `STRIPE_WEBHOOK_SECRET` | Netlify env vars | Stripe → Developers → Webhooks → *Add endpoint* `https://<site>/api/stripe/webhook`, event `checkout.session.completed` → copy the signing secret. |
| `RESEND_API_KEY`, `MAIL_FROM` | Netlify env vars | Resend → API keys. `MAIL_FROM` like `Coursehub <hello@yourdomain>` (domain verified in Resend). Unset = emails are only logged. |
| `SITE_URL` | Netlify env vars | `https://cupcourse.netlify.app` — used in email links and Stripe return URLs. |

### Making yourself admin

The first account created on an empty `users` table is the admin. On a site
that already has users, sign up with the break-glass token:
`curl -X POST $SITE/api/auth/signup -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"name":"…","email":"…","password":"…"}'`
— or change a role in Admin → Learners while signed in with the token.

Changing an env var on Netlify requires a new deploy to reach the function.

## Deploy

Netlify is connected to GitHub. Every push to `main`:

1. `npm ci`
2. **Build command `npm run migrate`** — applies pending `migrations/*.sql`
   inside one transaction (advisory-locked, so parallel builds can't race),
   then seeds if the catalog is empty. Non-zero exit = failed build = previous
   deploy stays live.
3. Publishes `public/` and bundles `netlify/functions/api.mjs`.

Pull requests get a **deploy preview** (`deploy-preview-N--cupcourse.netlify.app`)
that runs migrations against the same database — migrations must therefore be
backward compatible with the currently deployed code (add columns, don't
rename; drop only in a later migration after the code stopped using them).

Manual deploy from a laptop: `npx netlify login`, `npx netlify link`, then
`npm run deploy`.

## Writing a migration

1. Add `migrations/NNN-short-name.sql` with the next number. Plain SQL; it
   runs inside a transaction. Make it idempotent where cheap
   (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
2. Never `DROP` or rewrite a table in the same release that stops using it.
3. Run `npm run test:integration` — it applies every migration to an empty
   database, re-runs them (must be a no-op) and exercises the API on top.
4. Open a PR. CI runs the same against Postgres 16.

## Rollback

**Code**: Netlify → Deploys → pick the previous successful deploy → *Publish
deploy*. Instant; no build.

**Schema**: migrations are forward-only. If a migration must be undone, write
the reverse as a new migration (`NNN-revert-...sql`) and deploy it. Because
migrations are additive, rolling back *code* alone is always safe.

**Data**: restore from a backup (below) or from a Neon branch.

## Backup and restore

Neon keeps point-in-time history (7 days on the free plan) and supports
branching: *Neon console → Branches → Create branch → from a timestamp* gives
you a copy of the database as it was, without touching production.

Logical backups with standard tools (any Postgres host works the same way):

```bash
# backup — the pooled URL works for pg_dump; use the direct (non-pooler) URL for large DBs
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f coursehub-$(date +%F).dump

# restore into an empty database
pg_restore --no-owner --no-privileges -d "$TARGET_DATABASE_URL" coursehub-2026-09-17.dump

# or restore only data into an existing, migrated schema
pg_restore --data-only --disable-triggers -d "$TARGET_DATABASE_URL" coursehub-2026-09-17.dump
```

Before any risky migration or bulk edit: take a `pg_dump` **and** create a
Neon branch. Restoring = point `DATABASE_URL` at the branch (or a restored
database) and redeploy.

## Recovery checklist

| Symptom | Check | Fix |
|---------|-------|-----|
| Site up, every API call 500 | Netlify → Functions → api → logs. Usually `DATABASE_URL` missing/rotated or Neon paused. | Fix the env var, trigger deploy. Neon free-tier computes sleep after inactivity; first request may be slow, not failing. |
| Build fails at `[migrate]` | Build log shows the failing SQL. | Fix the migration in a PR; previous deploy is still live. |
| Admin sign-in returns 401 with the right token | Env var value/scope on Netlify; was a deploy triggered after setting it? | Re-save, redeploy. |
| Catalog empty after a deploy | `SELECT count(*) FROM courses` — data is never dropped by migrations; check you're on the right database/branch. | Point `DATABASE_URL` back; restore from backup if truly gone. |
| Flood of reviews/applications | Admin Reviews/Instructors tabs; delete spam. Rate limit is per-IP and per-instance. | Tighten `LIMITS` in `api.mjs`, or add Netlify edge rate limiting. |

## Monitoring (not yet set up)

`GET /api/health` returns `{"ok":true}` without touching the database; point
any uptime pinger at it and at `/api/stats` (which does). Netlify → Functions
→ api shows logs, including every `[mail]` line and webhook decision
(`ignored: amount mismatch` etc.). Next: error tracking (Sentry's Netlify
integration) and a Stripe webhook-failure alert in the Stripe dashboard.
