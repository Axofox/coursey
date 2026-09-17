# QA strategy, risk matrix and test report

## Strategy

Three layers, each answering a different question, all runnable with one
command and all gating pull requests in CI.

| Layer | Question | Tool | Data | Runtime |
|-------|----------|------|------|---------|
| **Unit** (`test/*.test.mjs`) | Does the API route, authorise and validate correctly? Do the shared browser helpers format and escape correctly? | Node's built-in `node --test`, no dependencies. API runs through `createHandler({ query })` with a scripted fake database that records every SQL call and its parameters. Browser helpers load `api.js` in a `vm` sandbox. | none | ~0.4 s |
| **Integration** (`test/integration/`) | Do the migrations apply to a real Postgres and does the API behave end-to-end with real SQL (joins, JSONB, cascades, derived ratings)? | Same test runner; real `pg`; embedded Postgres locally, a `postgres:16` service in CI. | fresh DB per run, seeded by the migration step | ~2 s + DB start |
| **End-to-end** (`e2e/`) | Do the pages work as a user sees them — search, cart, checkout validation, lesson gating, admin sign-in, moderation, editor? | Playwright, desktop Chrome + Pixel 7 emulation, against the mock API server (deterministic, `POST /api/_reset` between tests). | seed + one pending review | ~20 s |

Principles:

- **Test the contract, not the implementation.** Unit tests assert on
  status codes, error messages and the exact SQL parameters — the things a
  client or a database would notice — not on internal function calls.
- **One command, no setup.** `npm run test:all`. Contributors and CI run the
  same thing; the embedded Postgres means "no database installed" is not an
  excuse.
- **Every bug found during the build became a test.** Examples: NULL
  description in the seed (→ seed integrity test), rate limiter tripping
  across tests (→ explicit rate-limit tests + reset), stale cart format (→
  "old entries ignored" test), draft courses leaking (→ lifecycle test asserts
  404 for drafts publicly and 200 for admin).
- **Isolation.** Each e2e spec resets the mock; integration tests run in a
  database that never existed before the run; unit tests reset the rate
  limiter per handler.
- **Security is tested like a feature**: token gate, wrong token, `?all=1`
  without token, honeypot, body size, rate limits, SQL built only from
  validated keys, error responses that leak nothing.

What is deliberately *not* covered yet: visual regression (no baseline
images in CI), accessibility audits (manual only so far), load/performance,
and anything requiring accounts or payments (they don't exist).

## Risk matrix

Likelihood × impact, current mitigation, and what closes the gap.

| # | Risk | L | I | Mitigation today | Gap / next step |
|---|------|---|---|------------------|-----------------|
| 1 | Shared admin token leaks → catalog defaced | M | H | Token only in Netlify env + tab-scoped `sessionStorage`; timing-safe compare; bad-token rate limit; no writes at all if token unset | Individual accounts + roles (P0); token rotation runbook exists in OPERATIONS.md |
| 2 | Checkout ever trusts browser prices | L | H | Cart never reaches the server; "Pay" explicitly charges nothing | Stripe Checkout with server-side price lookup and webhook-created enrolments (P0) |
| 3 | Migration breaks production | L | H | Transactional, advisory-locked, forward-only; failed migration = failed build, old deploy stays live; integration test replays every migration incl. the legacy upgrade path | Deploy previews run migrations against prod DB — keep them backward compatible (documented) |
| 4 | Data loss (bad migration/bulk edit) | L | H | No `DROP` in migrations; Neon PITR + branches; `pg_dump` runbook | Scheduled off-platform backups |
| 5 | Review / application spam | H | L | Honeypot, per-IP rate limit, admin approval before anything is public, length limits | Shared rate-limit store; optional CAPTCHA if abuse appears |
| 6 | XSS via course content, reviews, names | M | H | Every render path escapes (`esc`), CSP blocks inline scripts, unit test proves cards escape `<img onerror>` | Add an automated DOM-XSS payload sweep to e2e |
| 7 | CSP breaks a page (blocked script/embed) | M | M | Inline scripts removed everywhere; e2e runs every page; embeds limited to YouTube/Vimeo | CSP report-only endpoint to catch regressions in the wild |
| 8 | Preview gating bypass (paid lessons watched free) | M | M | Player only plays `preview` lessons; but the **video URL is in the public API** for all lessons | Until purchases exist, don't attach real paid videos; then serve signed URLs per enrolment |
| 9 | Rate limiter ineffective (many function instances) | M | L | Documented as best-effort | Netlify edge rate limiting or a shared store |
| 10 | Dark-mode contrast regressions | M | L | Every semantic token redefined; component corrections; screenshots in docs | Automated contrast checks (axe) in e2e |
| 11 | Neon free tier sleeps → first request slow | H | L | Pool retries; UI shows "loading" then error state | Uptime pinger; paid tier when traffic justifies |
| 12 | Dependency vulnerability | M | M | `npm audit --audit-level=high` in CI, only one runtime dependency (`pg`) | Dependabot |
| 13 | Secret committed | L | H | `.env` gitignored; gitleaks scans full history in CI | Pre-commit hook |

L/I: Low · Medium · High.

## Test report — 2026-09-17

Branch `feat/hardening`, Node 24.18, macOS (local) and Ubuntu (CI).

| Suite | Tests | Pass | Fail | Time |
|-------|------:|-----:|-----:|-----:|
| Unit — API routing, auth, validation, abuse protection | 33 | 33 | 0 | 0.2 s |
| Unit — seed integrity | 3 | 3 | 0 | <0.1 s |
| Unit — browser helpers (format, escape, cart, wishlist, rules) | 11 | 11 | 0 | <0.1 s |
| Integration — migrations (fresh, idempotent, legacy upgrade) | 3 | 3 | 0 | 1.8 s |
| Integration — API on Postgres (catalog, lifecycle, categories, reviews→rating, bundles, applications, cascade) | 7 | 7 | 0 | 0.2 s |
| E2E — catalog (chromium + mobile) | 12 | 12 | 0 | |
| E2E — course / cart / lesson / bundle (chromium + mobile) | 12 | 12 | 0 | |
| E2E — admin + editor (chromium) | 6 | 6 | 0 | |
| **Total** | **87** | **87** | **0** | ~25 s |

Defects found and fixed while building the suites (all now covered):

1. Seed inserted `NULL` into `NOT NULL description` → first production migration failed (500s). *Integration: "apply cleanly on an empty database".*
2. In-memory rate limiter shared across unit tests produced spurious 429s → made resettable per handler; explicit limit tests added.
3. E2E mobile project matched every spec because the repository path contains "course" → anchored `testMatch` to the `e2e/` folder.
4. E2E admin tests shared mutable mock state → `POST /api/_reset` per test.
5. Editor spec assumed the publish button is visible on step 1 → test now navigates the stepper like a user.
6. Old cart entries (pre-bundle format) had no `key` and rendered as `undefined` → filtered on read; unit test.

Known gaps (tracked in the risk matrix): no visual-regression baseline, no
axe accessibility run, no load test, no coverage for account/payment flows
because they don't exist yet.

## Running it

```bash
npm test                  # unit
npm run test:integration  # needs nothing locally (embedded Postgres) or DATABASE_URL in CI
npm run test:e2e          # npx playwright install chromium once
npm run test:all
npx playwright show-report   # after an e2e failure in CI, download the artifact first
```
