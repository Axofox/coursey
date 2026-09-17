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
- State that must survive a reload but has no account to attach to (cart,
  wishlist, lesson progress, theme) is `localStorage`. It is per-browser and
  is **never trusted by the server** — the cart sends nothing to the API today,
  and when checkout arrives prices are recomputed server-side.

## API

`netlify/functions/api.mjs` exports `createHandler({ query })`. The default
export wires it to the real `pg` pool; tests pass a fake or a test database.

Request flow:

1. Parse `/api/<resource>/<id?>`; unknown resource → 404.
2. Rate-limit checks (per client IP, sliding 10-minute window, per function
   instance): 20 bad-token attempts, 10 public submissions.
3. Authorization: `Authorization: Bearer <ADMIN_TOKEN>` compared with
   `timingSafeEqual`. Public routes are the catalog reads and the two public
   `POST`s (reviews, applications). Everything else is admin-only. `?all=1`
   (include drafts) is admin-only too.
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
Anyone posts to `/api/reviews` (honeypot field + rate limit). It is stored as
`pending`. Admin approves in the Reviews tab (`PUT /api/reviews/:id`), after
which it appears on the course page and drives the rating.

**Admin edit**
`admin.js` / `editor.js` keep the token in `sessionStorage` (tab-scoped) and
send it as a Bearer header. The editor posts the whole validated course
object; the server re-validates everything.

**Deploy**
`git push` → Netlify runs `npm run migrate` (applies any new
`migrations/NNN-*.sql` in a transaction, seeds an empty catalog) → publishes
`public/` and bundles the function. A failed migration fails the build, so the
previous deploy stays live.

## Security posture (current)

- Single shared `ADMIN_TOKEN` gate — adequate for one operator, **not** for
  multiple users; individual accounts and roles are the top P0 item.
- CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (the design
  system uses inline styles), frames only from YouTube/Vimeo, `connect-src
  'self'`. Plus HSTS, nosniff, `X-Frame-Options: DENY`, referrer and
  permissions policies (`netlify.toml`).
- All rendering escapes user content (`Coursehub.esc`); the API never trusts
  client column names, ids are validated as integers, colours as `#RRGGBB`,
  links as `http(s)://`.
- Rate limiting is in-memory per function instance — a deterrent, not a
  guarantee. A shared store (or Netlify's edge rate limiting) is the upgrade.
