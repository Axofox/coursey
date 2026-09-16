/*
  JSON API for categories and courses.

    GET    /api/categories          public  — all categories with their courses
    GET    /api/categories/:id      public  — one category with its courses
    POST   /api/categories          admin   — { name, description }
    PUT    /api/categories/:id      admin   — { name?, description? }
    DELETE /api/categories/:id      admin   — also deletes its courses
    POST   /api/courses             admin   — { category_id, title, description?, level?, lessons? }
    PUT    /api/courses/:id         admin   — { title?, description?, level?, lessons? }
    DELETE /api/courses/:id         admin
    GET    /api/auth/check          admin   — 204 if the token is valid, used by the admin login

  Reads are public. Writes need `Authorization: Bearer <ADMIN_TOKEN>`.
*/
import { timingSafeEqual } from "node:crypto";
import { query } from "../lib/db.mjs";

export const config = { path: "/api/*" };

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
const error = (message, status) => json({ error: message }, status);

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

async function readBody(req) {
  try {
    return (await req.json()) ?? {};
  } catch (e) {
    return null;
  }
}

/* ---------- Queries ---------- */

async function listCategories(id) {
  const where = id ? "WHERE c.id = $1" : "";
  const params = id ? [id] : [];
  const { rows } = await query(
    `SELECT c.id, c.name, c.description,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', k.id, 'title', k.title, 'description', k.description,
                        'level', k.level, 'lessons', k.lessons)
                      ORDER BY k.sort_order, k.id)
                 FROM courses k WHERE k.category_id = c.id),
              '[]'::json) AS courses
       FROM categories c ${where}
      ORDER BY c.sort_order, c.created_at`,
    params
  );
  return rows;
}

/* ---------- Handlers ---------- */

async function handleCategories(req, id) {
  switch (req.method) {
    case "GET": {
      if (!id) return json(await listCategories());
      const [cat] = await listCategories(id);
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
      const exists = await query("SELECT 1 FROM categories WHERE id = $1", [newId]);
      if (exists.rowCount) return error("A category with that name already exists", 409);
      const { rows } = await query("SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM categories");
      await query(
        "INSERT INTO categories (id, name, description, sort_order) VALUES ($1,$2,$3,$4)",
        [newId, name, clean(body.description), rows[0].next]
      );
      const [cat] = await listCategories(newId);
      return json(cat, 201);
    }
    case "PUT": {
      if (!id) return error("Not found", 404);
      const body = await readBody(req);
      if (!body) return error("Invalid JSON", 400);
      const name = body.name !== undefined ? clean(body.name) : undefined;
      if (name === "") return error("name cannot be empty", 400);
      const description = body.description !== undefined ? clean(body.description) : undefined;
      const res = await query(
        `UPDATE categories
            SET name = COALESCE($2, name), description = COALESCE($3, description)
          WHERE id = $1`,
        [id, name, description]
      );
      if (!res.rowCount) return error("Category not found", 404);
      const [cat] = await listCategories(id);
      return json(cat);
    }
    case "DELETE": {
      if (!id) return error("Not found", 404);
      const res = await query("DELETE FROM categories WHERE id = $1", [id]);
      return res.rowCount ? new Response(null, { status: 204 }) : error("Category not found", 404);
    }
    default:
      return error("Method not allowed", 405);
  }
}

function courseFields(body) {
  const out = {};
  if (body.title !== undefined) {
    out.title = clean(body.title);
    if (!out.title) return { error: "title is required" };
  }
  if (body.description !== undefined) out.description = clean(body.description);
  if (body.level !== undefined) {
    out.level = clean(body.level);
    if (!LEVELS.includes(out.level)) return { error: `level must be one of: ${LEVELS.join(", ")}` };
  }
  if (body.lessons !== undefined) {
    out.lessons = Number(body.lessons);
    if (!Number.isInteger(out.lessons) || out.lessons < 0) return { error: "lessons must be a whole number" };
  }
  return { fields: out };
}

async function handleCourses(req, id) {
  switch (req.method) {
    case "POST": {
      if (id) return error("Not found", 404);
      const body = await readBody(req);
      if (!body) return error("Invalid JSON", 400);
      const categoryId = clean(body.category_id);
      if (!categoryId) return error("category_id is required", 400);
      if (body.title === undefined) return error("title is required", 400);
      const { fields, error: msg } = courseFields(body);
      if (msg) return error(msg, 400);
      const cat = await query("SELECT 1 FROM categories WHERE id = $1", [categoryId]);
      if (!cat.rowCount) return error("Category not found", 404);
      const { rows: next } = await query(
        "SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM courses WHERE category_id = $1",
        [categoryId]
      );
      const { rows } = await query(
        `INSERT INTO courses (category_id, title, description, level, lessons, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, category_id, title, description, level, lessons`,
        [categoryId, fields.title, fields.description ?? "", fields.level ?? "Beginner", fields.lessons ?? 0, next[0].next]
      );
      return json(rows[0], 201);
    }
    case "PUT": {
      const courseId = Number(id);
      if (!Number.isInteger(courseId)) return error("Not found", 404);
      const body = await readBody(req);
      if (!body) return error("Invalid JSON", 400);
      const { fields, error: msg } = courseFields(body);
      if (msg) return error(msg, 400);
      const { rows } = await query(
        `UPDATE courses
            SET title = COALESCE($2, title), description = COALESCE($3, description),
                level = COALESCE($4, level), lessons = COALESCE($5, lessons)
          WHERE id = $1
          RETURNING id, category_id, title, description, level, lessons`,
        [courseId, fields.title, fields.description, fields.level, fields.lessons]
      );
      return rows[0] ? json(rows[0]) : error("Course not found", 404);
    }
    case "DELETE": {
      const courseId = Number(id);
      if (!Number.isInteger(courseId)) return error("Not found", 404);
      const res = await query("DELETE FROM courses WHERE id = $1", [courseId]);
      return res.rowCount ? new Response(null, { status: 204 }) : error("Course not found", 404);
    }
    default:
      return error("Method not allowed", 405);
  }
}

/* ---------- Router ---------- */

export default async function handler(req) {
  const url = new URL(req.url);
  const [, , resource, id, extra] = url.pathname.split("/"); // ["", "api", resource, id?]
  if (extra !== undefined) return error("Not found", 404);

  // Everything except GET on categories requires the admin token.
  const isRead = req.method === "GET" && resource === "categories";
  if (!isRead && !isAuthorized(req)) return error("Unauthorized", 401);

  try {
    if (resource === "auth" && id === "check" && req.method === "GET") {
      return new Response(null, { status: 204 });
    }
    if (resource === "categories") return await handleCategories(req, id);
    if (resource === "courses") return await handleCourses(req, id);
    return error("Not found", 404);
  } catch (e) {
    console.error(e);
    return error("Server error", 500);
  }
}
