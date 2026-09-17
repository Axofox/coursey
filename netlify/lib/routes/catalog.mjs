/* Categories, courses, bundles, stats. */
import { json, error, noContent, readBody, bodyError, clean, isColor, slugify, idOr404 } from "../http.mjs";
import { COURSE_FIELDS, BUNDLE_FIELDS, parseFields, normaliseStatus } from "../validate.mjs";

// pg returns NUMERIC as strings; hand the client real numbers
export const shapeCourse = (row) => ({
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
  c.students, c.featured, c.published, c.status, c.owner_id, c.updated_at,
  (SELECT count(*)::int FROM jsonb_array_elements(c.curriculum) s, jsonb_array_elements(s->'lessons')) AS lesson_count,
  (SELECT count(*)::int FROM enrolments e WHERE e.course_id = c.id) AS enrolled_count`;

export async function listCourses(query, { category, q, featured, all, ids, ownerId, status }) {
  const where = [];
  const params = [];
  if (!all) where.push("c.published");
  if (category) { params.push(category); where.push(`c.category_id = $${params.length}`); }
  if (featured) where.push("c.featured");
  if (ids) { params.push(ids); where.push(`c.id = ANY($${params.length}::int[])`); }
  if (ownerId) { params.push(ownerId); where.push(`c.owner_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
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

export async function getCourseRow(query, id) {
  const { rows } = await query(
    `SELECT c.*, k.name AS category_name, k.icon_bg, k.icon_color,
            COALESCE(rv.avg, c.rating) AS rating, COALESCE(rv.n, c.rating_count) AS rating_count,
            (SELECT count(*)::int FROM enrolments e WHERE e.course_id = c.id) AS enrolled_count,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'rating', r.rating, 'body', r.body,
                                                        'verified', r.verified, 'created_at', r.created_at)
                             ORDER BY r.created_at DESC)
                        FROM reviews r WHERE r.course_id = c.id AND r.status = 'approved'), '[]'::json) AS reviews
       FROM courses c JOIN categories k ON k.id = c.category_id ${RATING_JOIN}
      WHERE c.id = $1`,
    [id]
  );
  return rows[0] ? shapeCourse(rows[0]) : null;
}

export async function isEnrolled(query, userId, courseId) {
  if (!userId) return false;
  const { rows } = await query("SELECT 1 FROM enrolments WHERE user_id = $1 AND course_id = $2", [userId, courseId]);
  return rows.length > 0;
}

export const canManage = (ctx, course) => ctx.admin || (ctx.user && course.owner_id === ctx.user.id);

/*
  Shape a course for a viewer: hide lesson video links unless the lesson is a
  free preview, the course is free, or the viewer is enrolled / owns it.
*/
export async function courseForViewer(ctx, course) {
  const enrolled = await isEnrolled(ctx.query, ctx.user && ctx.user.id, course.id);
  const full = enrolled || canManage(ctx, course) || course.price === 0;
  const curriculum = (course.curriculum || []).map((s) => ({
    ...s,
    lessons: (s.lessons || []).map((l) => (full || l.preview ? l : { ...l, video_url: l.video_url ? "locked" : "" })),
  }));
  let progress = [];
  if (ctx.user && enrolled) {
    const { rows } = await ctx.query(
      "SELECT section_idx, lesson_idx FROM lesson_progress WHERE user_id = $1 AND course_id = $2",
      [ctx.user.id, course.id]
    );
    progress = rows.map((r) => `${r.section_idx}-${r.lesson_idx}`);
  }
  return { ...course, curriculum, enrolled, can_manage: canManage(ctx, course), progress };
}

export async function listCategories(query) {
  const { rows } = await query(
    `SELECT k.*, (SELECT count(*)::int FROM courses c WHERE c.category_id = k.id AND c.published) AS course_count
       FROM categories k ORDER BY k.sort_order, k.created_at`
  );
  return rows;
}

export async function listBundles(query, { all, id }) {
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
  const courses = allIds.length ? await listCourses(query, { all, ids: allIds }) : [];
  const byId = new Map(courses.map((c) => [c.id, c]));
  return rows.map((b) => {
    const included = b.course_ids.map((cid) => byId.get(cid)).filter(Boolean);
    return { ...shapeBundle(b), courses: included, total_value: included.reduce((n, c) => n + c.price, 0) };
  });
}

/* ---------- Categories ---------- */
export async function categories(ctx, id) {
  const { query, req } = ctx;
  if (req.method === "GET") {
    const cats = await listCategories(query);
    if (!id) return json(cats);
    const cat = cats.find((c) => c.id === id);
    return cat ? json(cat) : error("Category not found", 404);
  }
  if (!ctx.admin) return error("Unauthorized", 401);
  switch (req.method) {
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
      return json((await listCategories(query)).find((c) => c.id === newId), 201);
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
        `UPDATE categories SET name = COALESCE($2, name), description = COALESCE($3, description),
                icon_bg = COALESCE($4, icon_bg), icon_color = COALESCE($5, icon_color) WHERE id = $1`,
        [id, name, description, icon_bg, icon_color]
      );
      if (!res.rowCount) return error("Category not found", 404);
      return json((await listCategories(query)).find((c) => c.id === id));
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

// Instructors can save drafts and submit for review; only admins publish.
function statusFor(ctx, fields, existing) {
  if (fields.status === undefined) return undefined;
  if (ctx.admin) return fields.status;
  if (fields.status === "published") return existing && existing.status === "published" ? "published" : "pending";
  return fields.status;
}

export async function courses(ctx, id) {
  const { query, req, url } = ctx;
  const courseId = idOr404(id);
  if (courseId === null) return error("Not found", 404);
  const instructor = ctx.admin || (ctx.user && ctx.user.role === "instructor");

  switch (req.method) {
    case "GET": {
      if (courseId === undefined) {
        const mine = url.searchParams.get("mine") === "1";
        if (mine) {
          if (!ctx.user) return error("Unauthorized", 401);
          return json(await listCourses(query, { all: true, ownerId: ctx.user.id }));
        }
        const all = url.searchParams.get("all") === "1";
        if (all && !ctx.admin) return error("Unauthorized", 401);
        return json(await listCourses(query, {
          category: url.searchParams.get("category") || "",
          q: (url.searchParams.get("q") || "").trim().slice(0, 100),
          featured: url.searchParams.get("featured") === "1",
          status: all ? url.searchParams.get("status") || "" : "",
          all,
        }));
      }
      const course = await getCourseRow(query, courseId);
      if (!course || (!course.published && !canManage(ctx, course))) return error("Course not found", 404);
      return json(await courseForViewer(ctx, course));
    }
    case "POST": {
      if (courseId !== undefined) return error("Not found", 404);
      if (!instructor) return error("Unauthorized", 401);
      const body = await readBody(req);
      if (!body || body === "too-large") return bodyError(body);
      const shorthand = normaliseStatus(body);
      if (shorthand.error) return error(shorthand.error, 400);
      const { fields, error: msg } = parseFields(COURSE_FIELDS, body, { creating: true });
      if (msg) return error(msg, 400);
      const cat = await query("SELECT 1 FROM categories WHERE id = $1", [fields.category_id]);
      if (!cat.rowCount) return error("Category not found", 404);
      const status = statusFor(ctx, fields, null) ?? "draft";
      delete fields.status;
      if (!ctx.admin) {
        fields.owner_id = ctx.user.id;
        fields.instructor_name = fields.instructor_name || ctx.user.name;
        delete fields.featured; // editorial pick is the admin's call
      } else if (body.owner_id !== undefined) {
        fields.owner_id = body.owner_id === null ? null : Number(body.owner_id);
      }
      const { rows: next } = await query("SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM courses");
      const keys = Object.keys(fields);
      const { rows } = await query(
        `INSERT INTO courses (${keys.join(", ")}, status, sort_order)
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1}, $${keys.length + 2})
         RETURNING id`,
        [...keys.map((k) => fields[k]), status, next[0].next]
      );
      return json(await courseForViewer(ctx, await getCourseRow(query, rows[0].id)), 201);
    }
    case "PUT": {
      if (courseId === undefined) return error("Not found", 404);
      const existing = await getCourseRow(query, courseId);
      if (!existing) return error("Course not found", 404);
      if (!canManage(ctx, existing)) return error("Unauthorized", 401);
      const body = await readBody(req);
      if (!body || body === "too-large") return bodyError(body);
      const shorthand = normaliseStatus(body);
      if (shorthand.error) return error(shorthand.error, 400);
      const { fields, error: msg } = parseFields(COURSE_FIELDS, body, { creating: false });
      if (msg) return error(msg, 400);
      if (fields.category_id) {
        const cat = await query("SELECT 1 FROM categories WHERE id = $1", [fields.category_id]);
        if (!cat.rowCount) return error("Category not found", 404);
      }
      const status = statusFor(ctx, fields, existing);
      delete fields.status;
      if (status !== undefined) fields.status = status;
      if (!ctx.admin) delete fields.featured;
      else if (body.owner_id !== undefined) fields.owner_id = body.owner_id === null ? null : Number(body.owner_id);
      const keys = Object.keys(fields);
      if (!keys.length) return error("Nothing to update", 400);
      await query(
        `UPDATE courses SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [courseId, ...keys.map((k) => fields[k])]
      );
      const updated = await getCourseRow(query, courseId);
      if (status === "published" && existing.status !== "published" && updated.owner_id) {
        const { rows: owner } = await query("SELECT name, email FROM users WHERE id = $1", [updated.owner_id]);
        if (owner[0]) ctx.notify("coursePublished", { id: updated.id, title: updated.title, owner_name: owner[0].name, owner_email: owner[0].email });
      }
      return json(await courseForViewer(ctx, updated));
    }
    case "DELETE": {
      if (courseId === undefined) return error("Not found", 404);
      const existing = await getCourseRow(query, courseId);
      if (!existing) return error("Course not found", 404);
      if (!canManage(ctx, existing)) return error("Unauthorized", 401);
      await query("DELETE FROM courses WHERE id = $1", [courseId]);
      return noContent();
    }
    default:
      return error("Method not allowed", 405);
  }
}

/* ---------- Bundles ---------- */
export async function bundles(ctx, id) {
  const { query, req, url } = ctx;
  const bundleId = idOr404(id);
  if (bundleId === null) return error("Not found", 404);
  if (req.method === "GET") {
    const all = url.searchParams.get("all") === "1";
    if (all && !ctx.admin) return error("Unauthorized", 401);
    if (bundleId === undefined) return json(await listBundles(query, { all }));
    const [bundle] = await listBundles(query, { all: ctx.admin, id: bundleId });
    return bundle ? json(bundle) : error("Bundle not found", 404);
  }
  if (!ctx.admin) return error("Unauthorized", 401);
  switch (req.method) {
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
      const [bundle] = await listBundles(query, { all: true, id: rows[0].id });
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
      const [bundle] = await listBundles(query, { all: true, id: bundleId });
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

export async function stats(ctx) {
  const { rows } = await ctx.query(
    `SELECT count(*)::int AS courses,
            count(DISTINCT NULLIF(instructor_name, ''))::int AS instructors,
            COALESCE(sum(students), 0)::int + (SELECT count(*)::int FROM enrolments) AS students,
            COALESCE(round(avg(rating) FILTER (WHERE rating_count > 0), 1), 0)::float AS avg_rating
       FROM courses WHERE published`
  );
  return json(rows[0]);
}
