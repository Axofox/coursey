# Architecture

```
Browser ──(static HTML/CSS/JS from Netlify CDN)──► public/
   │
   └──fetch /api/* ──► Netlify Function  netlify/functions/api.mjs
                            │  createHandler({ query })
                            └──pg ──► Postgres (Neon)   schema from migrations/
```

Three moving parts, deliberately boring: static files, one serverless function
that owns every `/api/*` route, one Postgres database. No framework, no build
step for the frontend, no ORM.

## Frontend

- Every page is a plain HTML file from the design handoff. Page-specific
  behaviour lives in `assets/<page>.js`; shared behaviour in `assets/api.js`
  (`window.Coursehub`): API client, browser cart and wishlist, toast, form
  validation, and the card/rating render helpers so every page draws a course
  the same way.
- Theme: `assets/theme-boot.js` runs synchronously in `<head>` and sets
  `data-theme="dark"` from `localStorage` before first paint. Tokens live in
  `styles.css`; dark mode redefines every semantic colour.
- No inline scripts or `on*=` attributes anywhere — the CSP forbids them.
- Browser-only state (cart, wishlist, theme, anonymous preview progress) is
  `localStorage`. It is **never trusted by the server** — checkout sends only
  item ids and prices are recomputed server-side. Signed-in progress lives in
  the database.

## API

`netlify/functions/api.mjs` exports `createHandler({ query, mailer, stripe })`.
The default export wires it to the real `pg` pool, Resend and Stripe; tests and
the dev server pass fakes.

Request flow:

1. Parse `/api/<resource>/<id?>`; unknown resource → 404.
2. Rate-limit checks (per client IP, sliding 10-minute window, per function
   instance): 20 bad-token attempts, 10 public submissions.
3. Authorization: the `ch_session` cookie resolves to a user (and role);
   `Authorization: Bearer <ADMIN_TOKEN>` (timing-safe compare) is the
   break-glass admin. Public: catalog reads, certificate verification,
   applications, signup/login/forgot/reset. Signed-in: reviews, enrol,
   progress, checkout, `me/*`. Instructor: own courses. Admin: everything
   else, incl. `?all=1`.
4. Body: JSON only, ≤ 64 KB, must be an object.
5. Validation: `COURSE_FIELDS` / `BUNDLE_FIELDS` map each writable column to a
   parser + error message; `parseFields` returns only the keys present, so
   `PUT` is a partial update and the SQL is built from the validated key list
   (never from client-supplied column names).
6. All SQL is parameterised. Numeric columns come back as strings from `pg`
   and are converted once in `shapeCourse` / `shapeBundle`.
7. Errors: validation → 4xx with a message; anything unexpected → logged and
   returned as `500 {"error":"Server error"}` without details.

Route summary is at the top of `api.mjs`.

## Data model

```
categories ─┬─< courses ─┬─< reviews (pending | approved)
            │            └─  curriculum JSONB: [{title, lessons:[{title, duration, video_url, preview}]}]
            │
bundles ────┴─  course_ids JSONB (resolved to published courses at read time)
instructor_applications
users ─┬─< sessions, password_resets
       ├─< orders ─< enrolments >─ courses      (webhook creates enrolments from paid orders)
       ├─< lesson_progress, certificates
       └─  owner of courses (owner_id), author of reviews, applications
schema_migrations, meta (legacy version marker)
```

A course's displayed `rating` / `rating_count` are derived at query time: the
average and count of **approved** reviews when there are any, otherwise the
manually entered fields. Bundles resolve their courses on read and skip drafts,
so unpublishing a course never breaks a bundle.

## Primary flows

**Browse → course → cart**
`home.js` calls `/api/categories`, `/api/courses?featured=1` (or `?q=` /
`?category=`), `/api/bundles`, `/api/stats`. Cards link to
`course-detail.html?id=N`; `course.js` fetches `/api/courses/N` and renders
every section from the record. *Add to cart* writes to `localStorage`;
`cart.js` renders those rows before `script.js` runs its totals maths.

**Review**
A signed-in learner posts to `/api/reviews` (one per course, rate limited,
flagged *verified* when enrolled). It is stored as `pending`. Admin approves in the Reviews tab (`PUT /api/reviews/:id`), after
which it appears on the course page and drives the rating.

**Admin / instructor edit**
`admin.js` / `editor.js` use the account session (or the break-glass token
kept in tab-scoped `sessionStorage`). The editor posts the whole validated
course object; the server re-validates everything and applies role rules.

**Deploy**
`git push` → Netlify runs `npm run migrate` (applies any new
`migrations/NNN-*.sql` in a transaction, seeds an empty catalog) → publishes
`public/` and bundles the function. A failed migration fails the build, so the
previous deploy stays live.

**Sign in**
`POST /api/auth/login` verifies the scrypt hash, inserts a session row (hash
of a random token) and sets `ch_session` (httpOnly, SameSite=Lax, Secure on
https). Every request resolves the cookie to a user in one query. Roles:
`learner` (default), `instructor` (granted by approving an application or by
an admin), `admin` (first account, or a signup carrying the break-glass token).

**Buy**
`POST /api/checkout` with `[ {kind, id} ]` → prices looked up in the DB, an
`orders` row (pending) is written, a Stripe Checkout Session is created via
REST with our cents and `client_reference_id = order id` → browser redirects
to Stripe. Stripe calls `POST /api/stripe/webhook`; the signature is verified
(HMAC-SHA256 over `t.body`, 5-minute tolerance), the amount must equal the
order, then the order is marked paid and one `enrolments` row per course is
inserted (idempotent — retries are harmless). The success page polls
`GET /api/orders/:id` until it is paid. Free carts skip Stripe entirely.

**Learn**
`GET /api/courses/:id` for an enrolled user returns every lesson's
`video_url` plus their progress; otherwise non-preview links come back as
`"locked"`. `POST /api/progress` records a lesson; when all lessons are done
a `certificates` row is created and `certificate.html?id=…` verifies it
publicly.

**Instruct**
An instructor's `POST/PUT /api/courses` is forced to `owner_id = self`,
status `draft` or `pending` (never `published`), and cannot set editorial
fields (featured, badge, manual stats). Admins publish from the review queue;
the owner gets an email.

## Security posture (current)

- Authentication is first-party (no vendor): scrypt (N=16384) password
  hashes, session tokens stored hashed, reset tokens hashed + single-use.
  The `ADMIN_TOKEN` remains as a break-glass and bootstrap mechanism only.
- Money: the browser never sends a price; Stripe sessions are created from
  database prices; webhooks are signature- and amount-checked.
- CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (the design
  system uses inline styles), frames only from YouTube/Vimeo, `connect-src
  'self'`. Plus HSTS, nosniff, `X-Frame-Options: DENY`, referrer and
  permissions policies (`netlify.toml`).
- All rendering escapes user content (`Coursehub.esc`); the API never trusts
  client column names, ids are validated as integers, colours as `#RRGGBB`,
  links as `http(s)://`.
- Rate limiting is in-memory per function instance — a deterrent, not a
  guarantee. A shared store (or Netlify's edge rate limiting) is the upgrade.
