# QA strategy, risk matrix and test report

## Strategy

Three layers, each answering a different question, all runnable with one
command and all gating pull requests in CI.

| Layer | Question | Tool | Data | Runtime |
|-------|----------|------|------|---------|
| **Unit** (`test/*.test.mjs`) | Does the API route, authorise and validate correctly? Do the shared browser helpers format and escape correctly? | Node's built-in `node --test`, no dependencies. API runs through `createHandler({ query })` with a scripted fake database that records every SQL call and its parameters. Browser helpers load `api.js` in a `vm` sandbox. | none | ~0.4 s |
| **Integration** (`test/integration/`) | Do the migrations apply to a real Postgres and does the API behave end-to-end with real SQL (joins, JSONB, cascades, derived ratings)? | Same test runner; real `pg`; embedded Postgres locally, a `postgres:16` service in CI. | fresh DB per run, seeded by the migration step | ~2 s + DB start |
| **End-to-end** (`e2e/`) | Do the pages work as a user sees them — search, cart, checkout, sign-up, buying, learning, certificates, instructor and admin workflows? | Playwright, desktop Chrome + Pixel 7 emulation, against `scripts/dev-server.mjs`: the **real API on an embedded Postgres**, Stripe stubbed with genuinely signed webhook events, emails captured. `POST /__test/reset` between tests. | seed | ~40 s |

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
- **Isolation.** Each e2e test resets the database and the rate limiter;
  integration tests run in a database that never existed before the run;
  unit tests reset the rate limiter per handler. E2E runs single-worker
  because the specs share one server.
- **Security is tested like a feature**: token gate, wrong token, `?all=1`
  without token, honeypot, body size, rate limits, SQL built only from
  validated keys, error responses that leak nothing.

What is deliberately *not* covered yet: visual regression (no baseline
images in CI), accessibility audits (manual only so far), load/performance,
and a real Stripe round-trip (the webhook path is exercised with our own
signed events; a Stripe test-mode smoke test after deploy is manual).

## Risk matrix

Likelihood × impact, current mitigation, and what closes the gap.

| # | Risk | L | I | Mitigation today | Gap / next step |
|---|------|---|---|------------------|-----------------|
| 1 | Account takeover / weak auth | M | H | scrypt hashes, 30-day httpOnly SameSite cookies with only a hash stored, password rules, login rate limit, reset tokens single-use + 1 h + revoke all sessions; admin = role, break-glass token optional | MFA; email verification on signup; session list + "sign out everywhere" |
| 2 | Paying the wrong amount / free enrolment | L | H | Browser sends ids only; server prices from the DB; webhook signature + amount check; fulfilment idempotent; free orders only when total is 0 | Stripe Tax; refunds flow (webhook `charge.refunded` → revoke enrolment) |
| 3 | Migration breaks production | L | H | Transactional, advisory-locked, forward-only; failed migration = failed build, old deploy stays live; integration test replays every migration incl. the legacy upgrade path | Deploy previews run migrations against prod DB — keep them backward compatible (documented) |
| 4 | Data loss (bad migration/bulk edit) | L | H | No `DROP` in migrations; Neon PITR + branches; `pg_dump` runbook | Scheduled off-platform backups |
| 5 | Review / application spam | H | L | Honeypot, per-IP rate limit, admin approval before anything is public, length limits | Shared rate-limit store; optional CAPTCHA if abuse appears |
| 6 | XSS via course content, reviews, names | M | H | Every render path escapes (`esc`), CSP blocks inline scripts, unit test proves cards escape `<img onerror>` | Add an automated DOM-XSS payload sweep to e2e |
| 7 | CSP breaks a page (blocked script/embed) | M | M | Inline scripts removed everywhere; e2e runs every page; embeds limited to YouTube/Vimeo | CSP report-only endpoint to catch regressions in the wild |
| 8 | Paid lessons watched without buying | L | M | Non-preview `video_url`s are only returned to enrolled learners, owners and admins (tested) | Signed/expiring video URLs once media is self-hosted |
| 9 | Rate limiter ineffective (many function instances) | M | L | Documented as best-effort | Netlify edge rate limiting or a shared store |
| 10 | Dark-mode contrast regressions | M | L | Every semantic token redefined; component corrections; screenshots in docs | Automated contrast checks (axe) in e2e |
| 11 | Neon free tier sleeps → first request slow | H | L | Pool retries; UI shows "loading" then error state | Uptime pinger; paid tier when traffic justifies |
| 12 | Dependency vulnerability | M | M | `npm audit --audit-level=high` in CI, only one runtime dependency (`pg`) | Dependabot |
| 13 | Secret committed | L | H | `.env` gitignored; gitleaks scans full history in CI | Pre-commit hook |

L/I: Low · Medium · High.

## Test report — 2026-09-19

Branch `feat/learner-setup`, Node 24.18, macOS (local) and Ubuntu (CI).

| Suite | Tests | Pass | Fail | Time |
|-------|------:|-----:|-----:|-----:|
| Unit — routing, auth gate, roles, validation, abuse protection, accounts, checkout pricing, webhook signatures | 43 | 43 | 0 | 0.5 s |
| Unit — learner setup: plan builder (light/heavy, reviews, track fallback), question ordering, grading, streaks, nudges, route gating | 12 | 12 | 0 | <0.1 s |
| Unit — seed integrity | 3 | 3 | 0 | <0.1 s |
| Unit — browser helpers | 11 | 11 | 0 | <0.1 s |
| Integration — migrations (fresh, idempotent, legacy upgrade incl. the `published` → `status` conversion) | 3 | 3 | 0 | 3 s |
| Integration — API on Postgres: catalog, lifecycle, accounts + sessions, password reset, reviews→rating, **checkout → webhook → enrolment**, progress → certificate, instructor approval → pending → publish, bundles, applications, cascades, **learner setup → plan → quiz → review → settings change → experiment** | 13 | 13 | 0 | 0.9 s |
| E2E — catalog (chromium + mobile) | 12 | 12 | 0 | |
| E2E — course / cart / lesson / bundle (chromium + mobile) | 12 | 12 | 0 | |
| E2E — accounts: signup, login + `?next`, reset via emailed link, **buy → learn → certificate**, free enrol + gating, review gating | 6 | 6 | 0 | |
| E2E — instructors: apply → approve → create → review queue → publish | 1 | 1 | 0 | |
| E2E — admin: account sign-in (+ break-glass), courses, categories, moderation, bundles, editor | 6 | 6 | 0 | |
| E2E — learner setup: unflagged course untouched, character-select → plan → grading → spaced review, settings from the dashboard, admin report + authoring | 4 | 4 | 0 | |
| **Total** | **126** | **126** | **0** | ~55 s |

E2E runs against the real API and a real (embedded) Postgres through
`scripts/dev-server.mjs`; Stripe is replaced by a stub that signs a genuine
`checkout.session.completed` event, so the webhook code path is the production one.

Defects found and fixed while building the suites (all now covered):

1. Seed inserted `NULL` into `NOT NULL description` → first production migration failed (500s). *Integration: "apply cleanly on an empty database".*
2. In-memory rate limiter shared across unit tests produced spurious 429s → made resettable per handler; explicit limit tests added.
3. E2E mobile project matched every spec because the repository path contains "course" → anchored `testMatch` to the `e2e/` folder.
4. E2E tests shared mutable state → database + rate-limit reset per test, single worker.
7. Parallel Playwright workers reset the shared database under each other → `workers: 1`.
8. The signed-out account menu overflowed the phone-width nav, widening the page so mobile clicks missed → nav trimmed at ≤600px, columns constrained to 100% (found by a failing mobile e2e).
9. Cart badge lost its `display:flex` when shown → class toggle; hero badge flashed placeholder text → hidden until the live count arrives.
10. Editor's top-bar "Save draft" silently unpublished an already-published course → "Save changes" keeps the status; found while testing question authoring on the live test course.
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
