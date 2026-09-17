/*
  Reviews (signed-in learners submit; admins moderate) and instructor
  applications (anyone submits; admins review).
*/
import { json, error, noContent, readBody, bodyError, clean, isEmail, isHttpUrl, idOr404 } from "../http.mjs";
import { isEnrolled } from "./catalog.mjs";

const REVIEW_STATUSES = ["pending", "approved"];
const APPLICATION_STATUSES = ["new", "approved", "rejected"];

export async function reviews(ctx, id) {
  const { query, req, url } = ctx;
  const reviewId = idOr404(id);
  if (reviewId === null) return error("Not found", 404);

  if (req.method === "POST" && reviewId === undefined) {
    if (!ctx.user) return error("Sign in to leave a review", 401);
    const body = await readBody(req);
    if (!body || body === "too-large") return bodyError(body);
    const course_id = Number(body.course_id);
    const rating = Number(body.rating);
    const text = clean(body.body, 2000);
    if (!Number.isInteger(course_id)) return error("course_id is required", 400);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return error("rating must be 1–5", 400);
    if (text.length < 10) return error("Please write at least a few words", 400);
    const course = await query("SELECT 1 FROM courses WHERE id = $1 AND published", [course_id]);
    if (!course.rowCount) return error("Course not found", 404);
    const dup = await query("SELECT 1 FROM reviews WHERE course_id = $1 AND user_id = $2", [course_id, ctx.user.id]);
    if (dup.rowCount) return error("You've already reviewed this course", 409);
    const verified = await isEnrolled(query, ctx.user.id, course_id);
    const { rows } = await query(
      "INSERT INTO reviews (course_id, user_id, name, rating, body, verified) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status",
      [course_id, ctx.user.id, ctx.user.name, rating, text, verified]
    );
    return json(rows[0], 201);
  }

  if (req.method === "GET" && reviewId === undefined && url.searchParams.get("mine") === "1") {
    // an instructor reading reviews on their own courses
    if (!ctx.user) return error("Unauthorized", 401);
    const { rows } = await query(
      `SELECT r.*, c.title AS course_title FROM reviews r JOIN courses c ON c.id = r.course_id
        WHERE c.owner_id = $1 AND r.status = 'approved' ORDER BY r.created_at DESC`,
      [ctx.user.id]
    );
    return json(rows);
  }

  if (!ctx.admin) return error("Unauthorized", 401);
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

export async function applications(ctx, id) {
  const { query, req } = ctx;
  const appId = idOr404(id);
  if (appId === null) return error("Not found", 404);

  if (req.method === "POST" && appId === undefined) {
    const body = await readBody(req);
    if (!body || body === "too-large") return bodyError(body);
    if (clean(body.website)) return noContent(); // honeypot
    const name = clean(body.name, 120) || (ctx.user && ctx.user.name) || "";
    const email = (clean(body.email, 200) || (ctx.user && ctx.user.email) || "").toLowerCase();
    const expertise = clean(body.expertise, 200);
    const bio = clean(body.bio, 2000);
    const portfolio_url = clean(body.portfolio_url, 300);
    if (!name) return error("Please add your name", 400);
    if (!isEmail(email)) return error("Please enter a valid email address", 400);
    if (!expertise) return error("Tell us what you'd teach", 400);
    if (portfolio_url && !isHttpUrl(portfolio_url)) return error("Portfolio link must start with http:// or https://", 400);
    const { rows } = await query(
      "INSERT INTO instructor_applications (name, email, expertise, bio, portfolio_url, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status",
      [name, email, expertise, bio, portfolio_url, ctx.user ? ctx.user.id : null]
    );
    return json(rows[0], 201);
  }

  if (!ctx.admin) return error("Unauthorized", 401);
  switch (req.method) {
    case "GET": {
      if (appId !== undefined) return error("Not found", 404);
      const { rows } = await query(
        `SELECT a.*, u.role AS user_role FROM instructor_applications a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC`
      );
      return json(rows);
    }
    case "PUT": {
      if (appId === undefined) return error("Not found", 404);
      const body = await readBody(req);
      if (body === "too-large") return bodyError(body);
      if (!body || !APPLICATION_STATUSES.includes(body.status)) return error(`status must be one of: ${APPLICATION_STATUSES.join(", ")}`, 400);
      const { rows } = await query("UPDATE instructor_applications SET status = $2 WHERE id = $1 RETURNING *", [appId, body.status]);
      if (!rows[0]) return error("Application not found", 404);
      if (body.status === "approved") {
        // Promote the matching account (by link or by email) to instructor
        const { rows: users } = await query(
          `UPDATE users SET role = 'instructor' WHERE role = 'learner' AND (id = $1 OR lower(email) = $2) RETURNING *`,
          [rows[0].user_id, rows[0].email]
        );
        ctx.notify("applicationApproved", { name: rows[0].name, email: rows[0].email, promoted: users.length > 0 });
      }
      return json(rows[0]);
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
