/*
  JSON API for the marketplace.

  Public:
    GET  /api/categories                   categories with published-course counts
    GET  /api/courses                      published course cards; ?category=slug ?q=text ?featured=1
    GET  /api/courses/:id                  one course with everything, incl. approved reviews
    GET  /api/bundles                      published bundles with their course cards
    GET  /api/bundles/:id
    GET  /api/stats                        { courses, instructors, students, avg_rating }
    POST /api/reviews                      { course_id, name, rating, body } → pending until approved
    POST /api/applications                 { name, email, expertise, bio?, portfolio_url? }

  Admin (Authorization: Bearer <ADMIN_TOKEN>):
    GET    /api/auth/check                 204 if the token is valid
    GET    /api/courses?all=1 · /api/bundles?all=1     include drafts
    POST/PUT/DELETE  /api/courses[/:id], /api/categories[/:id], /api/bundles[/:id]
    GET    /api/reviews[?status=pending]   PUT /api/reviews/:id { status }   DELETE /api/reviews/:id
    GET    /api/applications               PUT /api/applications/:id { status }   DELETE /api/applications/:id

  A course's displayed rating comes from its approved reviews when it has any,
  otherwise from the manually entered rating/rating_count.
*/
import { timingSafeEqual } from "node:crypto";
import { query as dbQuery } from "../lib/db.mjs";

export const config = { path: "/api/*" };

export const LEVELS = ["Beginner", "Intermediate", "Advanced"];
export const BADGES = ["Bestseller", "New"];
const REVIEW_STATUSES = ["pending", "approved"];
const APPLICATION_STATUSES = ["new", "approved", "rejected"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
const error = (message, status) => json({ error: message }, status);
const noContent = () => new Response(null, { status: 204 });

export function isAuthorized(req, expected = process.env.ADMIN_TOKEN) {
  if (!expected) return false; // never allow writes if the gate isn't configured
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const clean = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const MAX_BODY_BYTES = 64 * 1024; // a full course record is a few KB

// Returns the parsed object, null for invalid JSON, or the string "too-large".
async function readBody(req) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return "too-large";
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return "too-large";
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch (e) {
    return null;
  }
}
const bodyError = (body) => (body === "too-large" ? error("Request body too large", 413) : error("Invalid JSON", 400));

/*
  Rate limiting — a sliding window per client IP, kept in memory. Netlify
  Functions may run several instances, so this is a per-instance cap, not a
  global guarantee; it blunts casual abuse of the public write endpoints and
  token guessing without any extra infrastructure.
*/
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { write: 10, auth: 20 }; // per window
const buckets = new Map();
export function rateLimited(kind, ip, now = Date.now()) {
  const key = kind + ":" + ip;
  const hits = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (buckets.size > 5000) buckets.clear(); // keep memory bounded on a hot instance
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > LIMITS[kind];
}
export function resetRateLimits() { buckets.clear(); }
export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
}

/* ---------- Validation ---------- */

function money(v) {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
function count(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
function stringList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((s) => clean(s)).filter(Boolean);
  return out.length <= 50 ? out : undefined;
}
function idList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map(Number))];
  return out.every((n) => Number.isInteger(n) && n > 0) ? out : undefined;
}
export function curriculumList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const s of v) {
    if (!s || typeof s !== "object") return undefined;
    const title = clean(s.title);
    if (!title) continue;
    const lessons = [];
    for (const l of Array.isArray(s.lessons) ? s.lessons : []) {
      if (!l || typeof l !== "object") return undefined;
      const lt = clean(l.title);
      if (!lt) continue;
      const duration = clean(l.duration);
      if (duration && !/^\d{1,3}(:[0-5]\d)?$/.test(duration)) return undefined;
      const video_url = clean(l.video_url);
      if (video_url && !isHttpUrl(video_url)) return undefined;
      lessons.push({ title: lt, duration, video_url, preview: l.preview === true });
    }
    out.push({ title, lessons });
  }
  return out;
}

// One entry per writable course column: how to normalise the raw value and
// the message to return when it's invalid.
export const COURSE_FIELDS = {
  category_id:      { parse: (v) => clean(v), required: true, msg: "category_id is required" },
  title:            { parse: (v) => clean(v, 200), required: true, msg: "title is required" },
  subtitle:         { parse: (v) => clean(v, 500) },
  description:      { parse: (v) => clean(v, 10000) },
  instructor_name:  { parse: (v) => clean(v, 200) },
  instructor_title: { parse: (v) => clean(v, 200) },
  instructor_bio:   { parse: (v) => clean(v) },
  level:            { parse: (v) => (LEVELS.includes(v) ? v : undefined), msg: `level must be one of: ${LEVELS.join(", ")}` },
  language:         { parse: (v) => clean(v, 50) || "English" },
  price:            { parse: (v) => money(v) ?? undefined, msg: "price must be a number ≥ 0" },
  original_price:   { parse: money, msg: "original_price must be a number ≥ 0 or empty" },
  badge:            { parse: (v) => (v === null || v === "" ? null : BADGES.includes(v) ? v : undefined), msg: `badge must be one of: ${BADGES.join(", ")} or empty` },
  rating:           { parse: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : undefined; }, msg: "rating must be 0–5" },
  rating_count:     { parse: count, msg: "rating_count must be a whole number ≥ 0" },
  students:         { parse: count, msg: "students must be a whole number ≥ 0" },
  resources:        { parse: count, msg: "resources must be a whole number ≥ 0" },
  learn:            { parse: stringList, msg: "learn must be a list of strings", json: true },
  requirements:     { parse: stringList, msg: "requirements must be a list of strings", json: true },
  curriculum:       { parse: curriculumList, msg: "curriculum must be a list of sections with lessons (duration as m:ss, video_url as http(s) link)", json: true },
  featured:         { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "featured must be true/false" },
  published:        { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "published must be true/false" },
};

const BUNDLE_FIELDS = {
  name:        { parse: (v) => clean(v, 200), required: true, msg: "name is required" },
  description: { parse: (v) => clean(v, 1000) },
  price:       { parse: (v) => money(v) ?? undefined, msg: "price must be a number ≥ 0" },
  course_ids:  { parse: idList, msg: "course_ids must be a list of course ids", json: true },
  published:   { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "published must be true/false" },
};

// Returns { fields } with only the keys present in body, or { error }.
export function parseFields(spec, body, { creating }) {
  const fields = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (body[key] === undefined) {
      if (creating && rule.required) return { error: rule.msg };
      continue;
    }
    const value = rule.parse(body[key]);
    if (value === undefined || (rule.required && value === "")) return { error: rule.msg || `${key} is invalid` };
    fields[key] = rule.json ? JSON.stringify(value) : value;
  }
  return { fields };
}

/* ---------- Handler factory ---------- */

export function createHandler({ query } = { query: dbQuery }) {
  // pg returns NUMERIC as strings; hand the client real numbers
  const shapeCourse = (row) => ({
    ...row,
    price: Number(row.price),
    original_price: row.original_price === null ? null : Number(row.original_price),
    rating: Number(row.rating),
  });
  const shapeBundle = (row) => ({ ...row, price: Number(row.price) });

  // Rating shown = approved reviews if any, else the manual fields
  const RATING_JOIN = `
    LEFT JOIN LATERAL (
      SELECT round(avg(r.rating)::numeric, 1) AS avg, NULLIF(count(*), 0)::int AS n
        FROM reviews r WHERE r.course_id = c.id AND r.status = 'approved'
    ) rv ON true`;
  const CARD_COLUMNS = `
    c.id, c.category_id, k.name AS category_name, k.icon_bg, k.icon_color,
    c.title, c.subtitle, c.instructor_name, c.level, c.price, c.original_price, c.badge,
    COALESCE(rv.avg, c.rating) AS rating, COALESCE(rv.n, c.rating_count) AS rating_count,
    c.students, c.featured, c.published, c.updated_at,
    (SELECT count(*)::int FROM jsonb_array_elements(c.curriculum) s, jsonb_array_elements(s->'lessons')) AS lesson_count`;

  async function listCourses({ category, q, featured, all, ids }) {
    const where = [];
    const params = [];
    if (!all) where.push("c.published");
    if (category) { params.push(category); where.push(`c.category_id = $${params.length}`); }
    if (featured) where.push("c.featured");
    if (ids) { params.push(ids); where.push(`c.id = ANY($${params.length}::int[])`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(c.title ILIKE $${params.length} OR c.subtitle ILIKE $${params.length} OR c.instructor_name ILIKE $${params.length} OR k.name ILIKE $${params.length})`);
    }
    const { rows } = await query(
      `SELECT ${CARD_COLUMNS}
         FROM courses c JOIN categories k ON k.id = c.category_id ${RATING_JOIN}
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY c.sort_order, c.created_at`,
      params
    );
    return rows.map(shapeCourse);
  }

  async function getCourse(id, { all }) {
    const { rows } = await query(
      `SELECT c.*, k.name AS category_name, k.icon_bg, k.icon_color,
              COALESCE(rv.avg, c.rating) AS rating, COALESCE(rv.n, c.rating_count) AS rating_count,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at)
                               ORDER BY r.created_at DESC)
                          FROM reviews r WHERE r.course_id = c.id AND r.status = 'approved'), '[]'::json) AS reviews
         FROM courses c JOIN categories k ON k.id = c.category_id ${RATING_JOIN}
        WHERE c.id = $1 ${all ? "" : "AND c.published"}`,
      [id]
    );
    return rows[0] ? shapeCourse(rows[0]) : null;
  }

  async function listCategories() {
    const { rows } = await query(
      `SELECT k.*, (SELECT count(*)::int FROM courses c WHERE c.category_id = k.id AND c.published) AS course_count
         FROM categories k ORDER BY k.sort_order, k.created_at`
    );
    return rows;
  }

  async function listBundles({ all, id }) {
    const where = [];
    const params = [];
    if (!all) where.push("b.published");
    if (id) { params.push(id); where.push(`b.id = $${params.length}`); }
    const { rows } = await query(
      `SELECT b.* FROM bundles b ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY b.sort_order, b.created_at`,
      params
    );
    if (!rows.length) return [];
    const allIds = [...new Set(rows.flatMap((b) => b.course_ids))];
    const courses = allIds.length ? await listCourses({ all, ids: allIds }) : [];
    const byId = new Map(courses.map((c) => [c.id, c]));
    return rows.map((b) => {
      const included = b.course_ids.map((cid) => byId.get(cid)).filter(Boolean);
      const bundle = shapeBundle(b);
      return { ...bundle, courses: included, total_value: included.reduce((n, c) => n + c.price, 0) };
    });
  }

  /* ---------- Categories ---------- */
  async function handleCategories(req, id) {
    switch (req.method) {
      case "GET": {
        const cats = await listCategories();
        if (!id) return json(cats);
        const cat = cats.find((c) => c.id === id);
        return cat ? json(cat) : error("Category not found", 404);
      }
      case "POST": {
        if (id) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const name = clean(body.name, 100);
        if (!name) return error("name is required", 400);
        const newId = slugify(name);
        if (!newId) return error("name must contain letters or numbers", 400);
        const icon_bg = clean(body.icon_bg) || "#EDEBFB";
        const icon_color = clean(body.icon_color) || "#7A6DF0";
        if (!isColor(icon_bg) || !isColor(icon_color)) return error("colors must be #RRGGBB", 400);
        const exists = await query("SELECT 1 FROM categories WHERE id = $1", [newId]);
        if (exists.rowCount) return error("A category with that name already exists", 409);
        const { rows } = await query("SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM categories");
        await query(
          "INSERT INTO categories (id, name, description, icon_bg, icon_color, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
          [newId, name, clean(body.description, 300), icon_bg, icon_color, rows[0].next]
        );
        return json((await listCategories()).find((c) => c.id === newId), 201);
      }
      case "PUT": {
        if (!id) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const name = body.name !== undefined ? clean(body.name, 100) : undefined;
        if (name === "") return error("name cannot be empty", 400);
        const description = body.description !== undefined ? clean(body.description, 300) : undefined;
        const icon_bg = body.icon_bg !== undefined ? clean(body.icon_bg) : undefined;
        const icon_color = body.icon_color !== undefined ? clean(body.icon_color) : undefined;
        if ((icon_bg && !isColor(icon_bg)) || (icon_color && !isColor(icon_color))) return error("colors must be #RRGGBB", 400);
        const res = await query(
          `UPDATE categories
              SET name = COALESCE($2, name), description = COALESCE($3, description),
                  icon_bg = COALESCE($4, icon_bg), icon_color = COALESCE($5, icon_color)
            WHERE id = $1`,
          [id, name, description, icon_bg, icon_color]
        );
        if (!res.rowCount) return error("Category not found", 404);
        return json((await listCategories()).find((c) => c.id === id));
      }
      case "DELETE": {
        if (!id) return error("Not found", 404);
        const used = await query("SELECT count(*)::int AS n FROM courses WHERE category_id = $1", [id]);
        if (used.rows[0].n) return error(`Move or delete the ${used.rows[0].n} course(s) in this category first`, 409);
        const res = await query("DELETE FROM categories WHERE id = $1", [id]);
        return res.rowCount ? noContent() : error("Category not found", 404);
      }
      default:
        return error("Method not allowed", 405);
    }
  }

  /* ---------- Courses ---------- */
  async function handleCourses(req, id, admin, url) {
    const courseId = id === undefined ? undefined : Number(id);
    if (id !== undefined && !Number.isInteger(courseId)) return error("Not found", 404);

    switch (req.method) {
      case "GET": {
        const all = admin && url.searchParams.get("all") === "1";
        if (courseId === undefined) {
          return json(await listCourses({
            category: url.searchParams.get("category") || "",
            q: (url.searchParams.get("q") || "").trim().slice(0, 100),
            featured: url.searchParams.get("featured") === "1",
            all,
          }));
        }
        const course = await getCourse(courseId, { all: admin });
        return course ? json(course) : error("Course not found", 404);
      }
      case "POST": {
        if (courseId !== undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const { fields, error: msg } = parseFields(COURSE_FIELDS, body, { creating: true });
        if (msg) return error(msg, 400);
        const cat = await query("SELECT 1 FROM categories WHERE id = $1", [fields.category_id]);
        if (!cat.rowCount) return error("Category not found", 404);
        const { rows: next } = await query("SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM courses");
        const keys = Object.keys(fields);
        const { rows } = await query(
          `INSERT INTO courses (${keys.join(", ")}, sort_order)
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1})
           RETURNING id`,
          [...keys.map((k) => fields[k]), next[0].next]
        );
        return json(await getCourse(rows[0].id, { all: true }), 201);
      }
      case "PUT": {
        if (courseId === undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const { fields, error: msg } = parseFields(COURSE_FIELDS, body, { creating: false });
        if (msg) return error(msg, 400);
        if (fields.category_id) {
          const cat = await query("SELECT 1 FROM categories WHERE id = $1", [fields.category_id]);
          if (!cat.rowCount) return error("Category not found", 404);
        }
        const keys = Object.keys(fields);
        if (!keys.length) return error("Nothing to update", 400);
        const res = await query(
          `UPDATE courses SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
          [courseId, ...keys.map((k) => fields[k])]
        );
        if (!res.rowCount) return error("Course not found", 404);
        return json(await getCourse(courseId, { all: true }));
      }
      case "DELETE": {
        if (courseId === undefined) return error("Not found", 404);
        const res = await query("DELETE FROM courses WHERE id = $1", [courseId]);
        return res.rowCount ? noContent() : error("Course not found", 404);
      }
      default:
        return error("Method not allowed", 405);
    }
  }

  /* ---------- Bundles ---------- */
  async function handleBundles(req, id, admin, url) {
    const bundleId = id === undefined ? undefined : Number(id);
    if (id !== undefined && !Number.isInteger(bundleId)) return error("Not found", 404);

    switch (req.method) {
      case "GET": {
        const all = admin && url.searchParams.get("all") === "1";
        if (bundleId === undefined) return json(await listBundles({ all }));
        const [bundle] = await listBundles({ all: admin, id: bundleId });
        return bundle ? json(bundle) : error("Bundle not found", 404);
      }
      case "POST": {
        if (bundleId !== undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const { fields, error: msg } = parseFields(BUNDLE_FIELDS, body, { creating: true });
        if (msg) return error(msg, 400);
        const { rows: next } = await query("SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM bundles");
        const keys = Object.keys(fields);
        const { rows } = await query(
          `INSERT INTO bundles (${keys.join(", ")}, sort_order)
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1}) RETURNING id`,
          [...keys.map((k) => fields[k]), next[0].next]
        );
        const [bundle] = await listBundles({ all: true, id: rows[0].id });
        return json(bundle, 201);
      }
      case "PUT": {
        if (bundleId === undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (!body || body === "too-large") return bodyError(body);
        const { fields, error: msg } = parseFields(BUNDLE_FIELDS, body, { creating: false });
        if (msg) return error(msg, 400);
        const keys = Object.keys(fields);
        if (!keys.length) return error("Nothing to update", 400);
        const res = await query(
          `UPDATE bundles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`,
          [bundleId, ...keys.map((k) => fields[k])]
        );
        if (!res.rowCount) return error("Bundle not found", 404);
        const [bundle] = await listBundles({ all: true, id: bundleId });
        return json(bundle);
      }
      case "DELETE": {
        if (bundleId === undefined) return error("Not found", 404);
        const res = await query("DELETE FROM bundles WHERE id = $1", [bundleId]);
        return res.rowCount ? noContent() : error("Bundle not found", 404);
      }
      default:
        return error("Method not allowed", 405);
    }
  }

  /* ---------- Reviews (public submit, admin moderate) ---------- */
  async function handleReviews(req, id, admin, url) {
    if (req.method === "POST" && id === undefined) {
      const body = await readBody(req);
      if (!body || body === "too-large") return bodyError(body);
      if (clean(body.website)) return noContent(); // honeypot field: bots fill it, people don't
      const course_id = Number(body.course_id);
      const name = clean(body.name, 80);
      const rating = Number(body.rating);
      const text = clean(body.body, 2000);
      if (!Number.isInteger(course_id)) return error("course_id is required", 400);
      if (!name) return error("Please add your name", 400);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return error("rating must be 1–5", 400);
      if (text.length < 10) return error("Please write at least a few words", 400);
      const course = await query("SELECT 1 FROM courses WHERE id = $1 AND published", [course_id]);
      if (!course.rowCount) return error("Course not found", 404);
      const { rows } = await query(
        "INSERT INTO reviews (course_id, name, rating, body) VALUES ($1,$2,$3,$4) RETURNING id, status",
        [course_id, name, rating, text]
      );
      return json(rows[0], 201);
    }
    if (!admin) return error("Unauthorized", 401);
    const reviewId = id === undefined ? undefined : Number(id);
    if (id !== undefined && !Number.isInteger(reviewId)) return error("Not found", 404);

    switch (req.method) {
      case "GET": {
        if (reviewId !== undefined) return error("Not found", 404);
        const status = url.searchParams.get("status");
        const params = [];
        let where = "";
        if (status) {
          if (!REVIEW_STATUSES.includes(status)) return error("status must be pending or approved", 400);
          params.push(status);
          where = "WHERE r.status = $1";
        }
        const { rows } = await query(
          `SELECT r.*, c.title AS course_title FROM reviews r JOIN courses c ON c.id = r.course_id ${where} ORDER BY r.created_at DESC`,
          params
        );
        return json(rows);
      }
      case "PUT": {
        if (reviewId === undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (body === "too-large") return bodyError(body);
        if (!body || !REVIEW_STATUSES.includes(body.status)) return error("status must be pending or approved", 400);
        const { rows } = await query("UPDATE reviews SET status = $2 WHERE id = $1 RETURNING *", [reviewId, body.status]);
        return rows[0] ? json(rows[0]) : error("Review not found", 404);
      }
      case "DELETE": {
        if (reviewId === undefined) return error("Not found", 404);
        const res = await query("DELETE FROM reviews WHERE id = $1", [reviewId]);
        return res.rowCount ? noContent() : error("Review not found", 404);
      }
      default:
        return error("Method not allowed", 405);
    }
  }

  /* ---------- Instructor applications (public submit, admin review) ---------- */
  async function handleApplications(req, id, admin) {
    if (req.method === "POST" && id === undefined) {
      const body = await readBody(req);
      if (!body || body === "too-large") return bodyError(body);
      if (clean(body.website)) return noContent(); // honeypot
      const name = clean(body.name, 120);
      const email = clean(body.email, 200).toLowerCase();
      const expertise = clean(body.expertise, 200);
      const bio = clean(body.bio, 2000);
      const portfolio_url = clean(body.portfolio_url, 300);
      if (!name) return error("Please add your name", 400);
      if (!isEmail(email)) return error("Please enter a valid email address", 400);
      if (!expertise) return error("Tell us what you'd teach", 400);
      if (portfolio_url && !isHttpUrl(portfolio_url)) return error("Portfolio link must start with http:// or https://", 400);
      const { rows } = await query(
        "INSERT INTO instructor_applications (name, email, expertise, bio, portfolio_url) VALUES ($1,$2,$3,$4,$5) RETURNING id, status",
        [name, email, expertise, bio, portfolio_url]
      );
      return json(rows[0], 201);
    }
    if (!admin) return error("Unauthorized", 401);
    const appId = id === undefined ? undefined : Number(id);
    if (id !== undefined && !Number.isInteger(appId)) return error("Not found", 404);

    switch (req.method) {
      case "GET": {
        if (appId !== undefined) return error("Not found", 404);
        const { rows } = await query("SELECT * FROM instructor_applications ORDER BY created_at DESC");
        return json(rows);
      }
      case "PUT": {
        if (appId === undefined) return error("Not found", 404);
        const body = await readBody(req);
        if (body === "too-large") return bodyError(body);
        if (!body || !APPLICATION_STATUSES.includes(body.status)) return error(`status must be one of: ${APPLICATION_STATUSES.join(", ")}`, 400);
        const { rows } = await query("UPDATE instructor_applications SET status = $2 WHERE id = $1 RETURNING *", [appId, body.status]);
        return rows[0] ? json(rows[0]) : error("Application not found", 404);
      }
      case "DELETE": {
        if (appId === undefined) return error("Not found", 404);
        const res = await query("DELETE FROM instructor_applications WHERE id = $1", [appId]);
        return res.rowCount ? noContent() : error("Application not found", 404);
      }
      default:
        return error("Method not allowed", 405);
    }
  }

  async function handleStats() {
    const { rows } = await query(
      `SELECT count(*)::int AS courses,
              count(DISTINCT NULLIF(instructor_name, ''))::int AS instructors,
              COALESCE(sum(students), 0)::int AS students,
              COALESCE(round(avg(rating) FILTER (WHERE rating_count > 0), 1), 0)::float AS avg_rating
         FROM courses WHERE published`
    );
    return json(rows[0]);
  }

  /* ---------- Router ---------- */
  return async function handler(req, context) {
    const url = new URL(req.url);
    const [, , resource, id, extra] = url.pathname.split("/"); // ["", "api", resource, id?]
    if (extra !== undefined) return error("Not found", 404);

    const KNOWN = ["auth", "categories", "courses", "bundles", "reviews", "applications", "stats"];
    if (!KNOWN.includes(resource)) return error("Not found", 404);

    const ip = clientIp(req, context);
    const presentedToken = (req.headers.get("authorization") || "").startsWith("Bearer ");
    const admin = isAuthorized(req);
    if (presentedToken && !admin && rateLimited("auth", ip)) return error("Too many attempts — try again later", 429);
    const isPublicWrite = req.method === "POST" && ["reviews", "applications"].includes(resource) && id === undefined;
    if (isPublicWrite && !admin && rateLimited("write", ip)) return error("Too many submissions — try again later", 429);
    const isPublic =
      (req.method === "GET" && ["categories", "courses", "bundles", "stats"].includes(resource)) || isPublicWrite;
    if (!isPublic && !admin) return error("Unauthorized", 401);
    if (req.method === "GET" && url.searchParams.get("all") === "1" && !admin) return error("Unauthorized", 401);

    try {
      if (resource === "auth" && id === "check" && req.method === "GET") return noContent();
      if (resource === "categories") return await handleCategories(req, id);
      if (resource === "courses") return await handleCourses(req, id, admin, url);
      if (resource === "bundles") return await handleBundles(req, id, admin, url);
      if (resource === "reviews") return await handleReviews(req, id, admin, url);
      if (resource === "applications") return await handleApplications(req, id, admin);
      if (resource === "stats" && req.method === "GET" && id === undefined) return await handleStats();
      return error("Not found", 404);
    } catch (e) {
      console.error(e);
      return error("Server error", 500);
    }
  };
}

export default createHandler();
