/*
  JSON API for the course catalog.

  Public reads:
    GET /api/categories                    categories with published-course counts
    GET /api/courses                       published course cards; ?category=slug  ?q=text  ?featured=1
    GET /api/courses/:id                   one course with everything (published only, unless admin)
    GET /api/stats                         { courses, instructors, students, avg_rating }

  Admin (Authorization: Bearer <ADMIN_TOKEN>):
    GET    /api/auth/check                 204 if the token is valid
    GET    /api/courses?all=1              every course incl. drafts
    POST   /api/courses                    create   (body: course fields, see COURSE_FIELDS)
    PUT    /api/courses/:id                update   (partial)
    DELETE /api/courses/:id
    POST   /api/categories                 { name, description?, icon_bg?, icon_color? }
    PUT    /api/categories/:id
    DELETE /api/categories/:id             refused while courses still use it
*/
import { timingSafeEqual } from "node:crypto";
import { query } from "../lib/db.mjs";

export const config = { path: "/api/*" };

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const BADGES = ["Bestseller", "New"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
const error = (message, status) => json({ error: message }, status);
const noContent = () => new Response(null, { status: 204 });

function isAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false; // never allow writes if the gate isn't configured
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v);

async function readBody(req) {
  try {
    return (await req.json()) ?? {};
  } catch (e) {
    return null;
  }
}

/* ---------- Validation ---------- */

// Each field: how to normalise the raw value, and an error message if invalid.
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
  const out = v.map(clean).filter(Boolean);
  return out.length <= 50 ? out : undefined;
}
function curriculumList(v) {
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
      lessons.push({ title: lt, duration });
    }
    out.push({ title, lessons });
  }
  return out;
}

const COURSE_FIELDS = {
  category_id:      { parse: clean, required: true, msg: "category_id is required" },
  title:            { parse: clean, required: true, msg: "title is required" },
  subtitle:         { parse: clean },
  description:      { parse: clean },
  instructor_name:  { parse: clean },
  instructor_title: { parse: clean },
  instructor_bio:   { parse: clean },
  level:            { parse: (v) => (LEVELS.includes(v) ? v : undefined), msg: `level must be one of: ${LEVELS.join(", ")}` },
  language:         { parse: (v) => clean(v) || "English" },
  price:            { parse: (v) => money(v) ?? undefined, msg: "price must be a number ≥ 0" },
  original_price:   { parse: money, msg: "original_price must be a number ≥ 0 or empty", nullable: true },
  badge:            { parse: (v) => (v === null || v === "" ? null : BADGES.includes(v) ? v : undefined), msg: `badge must be one of: ${BADGES.join(", ")} or empty`, nullable: true },
  rating:           { parse: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : undefined; }, msg: "rating must be 0–5" },
  rating_count:     { parse: count, msg: "rating_count must be a whole number ≥ 0" },
  students:         { parse: count, msg: "students must be a whole number ≥ 0" },
  resources:        { parse: count, msg: "resources must be a whole number ≥ 0" },
  learn:            { parse: stringList, msg: "learn must be a list of strings", json: true },
  requirements:     { parse: stringList, msg: "requirements must be a list of strings", json: true },
  curriculum:       { parse: curriculumList, msg: "curriculum must be a list of sections with lessons (duration as m:ss)", json: true },
  featured:         { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "featured must be true/false" },
  published:        { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "published must be true/false" },
};

// Returns { fields } with only the keys present in body, or { error }.
function parseCourse(body, { creating }) {
  const fields = {};
  for (const [key, spec] of Object.entries(COURSE_FIELDS)) {
    if (body[key] === undefined) {
      if (creating && spec.required) return { error: spec.msg };
      continue;
    }
    const value = spec.parse(body[key]);
    if (value === undefined || (spec.required && value === "")) return { error: spec.msg || `${key} is invalid` };
    fields[key] = spec.json ? JSON.stringify(value) : value;
  }
  return { fields };
}

/* ---------- Queries ---------- */

const CARD_COLUMNS = `
  c.id, c.category_id, k.name AS category_name, k.icon_bg, k.icon_color,
  c.title, c.subtitle, c.instructor_name, c.level, c.price, c.original_price, c.badge,
  c.rating, c.rating_count, c.students, c.featured, c.published, c.updated_at,
  (SELECT count(*)::int FROM jsonb_array_elements(c.curriculum) s, jsonb_array_elements(s->'lessons')) AS lesson_count`;

function shapeCourse(row) {
  // pg returns NUMERIC as strings; hand the client real numbers
  return {
    ...row,
    price: Number(row.price),
    original_price: row.original_price === null ? null : Number(row.original_price),
    rating: Number(row.rating),
  };
}

async function listCourses({ category, q, featured, all }) {
  const where = [];
  const params = [];
  if (!all) where.push("c.published");
  if (category) { params.push(category); where.push(`c.category_id = $${params.length}`); }
  if (featured) where.push("c.featured");
  if (q) {
    params.push(`%${q}%`);
    where.push(`(c.title ILIKE $${params.length} OR c.subtitle ILIKE $${params.length} OR c.instructor_name ILIKE $${params.length} OR k.name ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT ${CARD_COLUMNS}
       FROM courses c JOIN categories k ON k.id = c.category_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.sort_order, c.created_at`,
    params
  );
  return rows.map(shapeCourse);
}

async function getCourse(id, { all }) {
  const { rows } = await query(
    `SELECT c.*, k.name AS category_name, k.icon_bg, k.icon_color
       FROM courses c JOIN categories k ON k.id = c.category_id
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

/* ---------- Handlers ---------- */

async function handleCategories(req, id, admin) {
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
      if (!body) return error("Invalid JSON", 400);
      const name = clean(body.name);
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
        [newId, name, clean(body.description), icon_bg, icon_color, rows[0].next]
      );
      return json((await listCategories()).find((c) => c.id === newId), 201);
    }
    case "PUT": {
      if (!id) return error("Not found", 404);
      const body = await readBody(req);
      if (!body) return error("Invalid JSON", 400);
      const name = body.name !== undefined ? clean(body.name) : undefined;
      if (name === "") return error("name cannot be empty", 400);
      const description = body.description !== undefined ? clean(body.description) : undefined;
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
      if (!body) return error("Invalid JSON", 400);
      const { fields, error: msg } = parseCourse(body, { creating: true });
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
      if (!body) return error("Invalid JSON", 400);
      const { fields, error: msg } = parseCourse(body, { creating: false });
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

export default async function handler(req) {
  const url = new URL(req.url);
  const [, , resource, id, extra] = url.pathname.split("/"); // ["", "api", resource, id?]
  if (extra !== undefined) return error("Not found", 404);

  const admin = isAuthorized(req);
  const isPublicRead = req.method === "GET" && ["categories", "courses", "stats"].includes(resource);
  if (!isPublicRead && !admin) return error("Unauthorized", 401);
  if (resource === "courses" && req.method === "GET" && url.searchParams.get("all") === "1" && !admin) {
    return error("Unauthorized", 401);
  }

  try {
    if (resource === "auth" && id === "check" && req.method === "GET") return noContent();
    if (resource === "categories") return await handleCategories(req, id, admin);
    if (resource === "courses") return await handleCourses(req, id, admin, url);
    if (resource === "stats" && req.method === "GET" && id === undefined) return await handleStats();
    return error("Not found", 404);
  } catch (e) {
    console.error(e);
    return error("Server error", 500);
  }
}
