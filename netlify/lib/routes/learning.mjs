/*
  The learner's side once signed in.
    GET  /api/me/courses                enrolled courses with progress
    GET  /api/me/orders                 purchase history
    GET  /api/me/certificates
    GET  /api/me/instructor             instructor overview (own courses, students, earnings)
    POST /api/enrol        { course_id }   free courses only (paid ones go through checkout)
    POST /api/progress     { course_id, section, lesson }   marks a lesson complete; issues a certificate at 100%
    GET  /api/certificates/:id          public verification
    GET  /api/orders/:id                own order (used by the checkout success page)
    GET  /api/orders?all=1              admin: every order
*/
import { json, error, readBody, bodyError, idOr404 } from "../http.mjs";
import { newToken } from "../auth.mjs";
import { listCourses, getCourseRow, isEnrolled } from "./catalog.mjs";
import { logEvent, flagOn } from "./learn.mjs";

const lessonCount = (curriculum) => (curriculum || []).reduce((n, s) => n + (s.lessons || []).length, 0);

export async function issueCertificateIfComplete(query, userId, courseId, notify) {
  const course = await getCourseRow(query, courseId);
  const total = lessonCount(course && course.curriculum);
  if (!total) return null;
  const { rows } = await query("SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = $1 AND course_id = $2 AND lesson_idx >= 0", [userId, courseId]);
  if (rows[0].n < total) return null;
  const { rows: cert } = await query(
    `INSERT INTO certificates (id, user_id, course_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, course_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *, (xmax = 0) AS fresh`,
    [newToken().slice(0, 20), userId, courseId]
  );
  return cert[0];
}

export async function me(ctx, what) {
  const { query, user } = ctx;
  if (!user) return error("Unauthorized", 401);
  if (ctx.req.method !== "GET") return error("Method not allowed", 405);

  switch (what) {
    case "courses": {
      const { rows: enr } = await query("SELECT course_id, created_at FROM enrolments WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      if (!enr.length) return json([]);
      const courses = await listCourses(query, { all: true, ids: enr.map((e) => e.course_id) });
      const { rows: prog } = await query(
        "SELECT course_id, count(*)::int AS done FROM lesson_progress WHERE user_id = $1 AND lesson_idx >= 0 GROUP BY course_id", [user.id]);
      const { rows: certs } = await query("SELECT course_id, id FROM certificates WHERE user_id = $1", [user.id]);
      const doneBy = new Map(prog.map((p) => [p.course_id, p.done]));
      const certBy = new Map(certs.map((c) => [c.course_id, c.id]));
      const order = new Map(enr.map((e, i) => [e.course_id, i]));
      return json(courses
        .sort((a, b) => order.get(a.id) - order.get(b.id))
        .map((c) => ({
          ...c,
          completed_lessons: doneBy.get(c.id) || 0,
          progress_pct: c.lesson_count ? Math.round(((doneBy.get(c.id) || 0) / c.lesson_count) * 100) : 0,
          certificate_id: certBy.get(c.id) || null,
          enrolled_at: enr.find((e) => e.course_id === c.id).created_at,
        })));
    }
    case "orders": {
      const { rows } = await query("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      return json(rows);
    }
    case "certificates": {
      const { rows } = await query(
        `SELECT ce.*, c.title AS course_title, c.instructor_name FROM certificates ce JOIN courses c ON c.id = ce.course_id
          WHERE ce.user_id = $1 ORDER BY ce.issued_at DESC`, [user.id]);
      return json(rows);
    }
    case "instructor": {
      if (user.role !== "instructor" && user.role !== "admin") return error("Unauthorized", 401);
      const courses = await listCourses(query, { all: true, ownerId: user.id });
      const ids = courses.map((c) => c.id);
      const { rows: students } = await query(
        `SELECT e.course_id, u.name, u.email, e.created_at FROM enrolments e JOIN users u ON u.id = e.user_id
          WHERE e.course_id = ANY($1::int[]) ORDER BY e.created_at DESC LIMIT 200`, [ids]);
      // Earnings: paid order items for these courses (bundles attribute their price evenly)
      const { rows: orders } = await query(
        `SELECT o.id, o.paid_at, o.items FROM orders o WHERE o.status = 'paid'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.items) it, jsonb_array_elements_text(it->'course_ids') cid
                         WHERE cid::int = ANY($1::int[]))
          ORDER BY o.paid_at DESC`, [ids]);
      const sales = [];
      for (const o of orders) {
        for (const it of o.items) {
          const mine = (it.course_ids || []).filter((cid) => ids.includes(Number(cid)));
          if (!mine.length) continue;
          const share = Math.round(it.price_cents / (it.course_ids || []).length) * mine.length;
          sales.push({ order_id: o.id, paid_at: o.paid_at, title: it.title, cents: share, courses: mine.map(Number) });
        }
      }
      const gross = sales.reduce((n, s) => n + s.cents, 0);
      return json({ courses, students, sales, gross_cents: gross, payout_cents: Math.round(gross * 0.85) });
    }
    default:
      return error("Not found", 404);
  }
}

export async function enrol(ctx) {
  const { query, user, req } = ctx;
  if (req.method !== "POST") return error("Method not allowed", 405);
  if (!user) return error("Sign in to enrol", 401);
  const body = await readBody(req);
  if (!body || body === "too-large") return bodyError(body);
  const courseId = Number(body.course_id);
  if (!Number.isInteger(courseId)) return error("course_id is required", 400);
  const course = await getCourseRow(query, courseId);
  if (!course || !course.published) return error("Course not found", 404);
  if (course.price > 0) return error("This course is paid — use checkout", 402);
  const res = await query("INSERT INTO enrolments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, courseId]);
  if (res.rowCount) await logEvent(query, "enrolled", { userId: user.id, courseId, props: { via: "free", flag: flagOn(course) } });
  return json({ enrolled: true, needs_setup: flagOn(course) }, 201);
}

export async function progress(ctx) {
  const { query, user, req } = ctx;
  if (req.method !== "POST") return error("Method not allowed", 405);
  if (!user) return error("Unauthorized", 401);
  const body = await readBody(req);
  if (!body || body === "too-large") return bodyError(body);
  const courseId = Number(body.course_id), s = Number(body.section), l = Number(body.lesson);
  if (![courseId, s, l].every(Number.isInteger) || s < 0 || l < 0) return error("course_id, section and lesson are required", 400);
  const course = await getCourseRow(query, courseId);
  if (!course) return error("Course not found", 404);
  const lesson = course.curriculum[s] && course.curriculum[s].lessons[l];
  if (!lesson) return error("Lesson not found", 404);
  const enrolled = await isEnrolled(query, user.id, courseId);
  if (!enrolled && course.price > 0 && !lesson.preview) return error("Enrol to track progress", 402);
  if (!enrolled && course.price === 0) {
    await query("INSERT INTO enrolments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, courseId]);
  }
  if (enrolled || course.price === 0) {
    await query(
      "INSERT INTO lesson_progress (user_id, course_id, section_idx, lesson_idx) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [user.id, courseId, s, l]
    );
  }
  const cert = await issueCertificateIfComplete(query, user.id, courseId, (issued) => issued);
  const { rows } = await query("SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = $1 AND course_id = $2 AND lesson_idx >= 0", [user.id, courseId]);
  await logEvent(query, "lesson_completed", { userId: user.id, courseId, props: { section: s, lesson: l, flag: flagOn(course) } });
  if (cert && cert.fresh) await logEvent(query, "course_completed", { userId: user.id, courseId, props: { flag: flagOn(course) } });
  return json({ completed_lessons: rows[0].n, total_lessons: lessonCount(course.curriculum), certificate_id: cert ? cert.id : null });
}

export async function certificates(ctx, id) {
  if (ctx.req.method !== "GET" || !id) return error("Not found", 404);
  const { rows } = await ctx.query(
    `SELECT ce.id, ce.issued_at, u.name AS learner_name, c.title AS course_title, c.instructor_name, c.id AS course_id,
            (SELECT count(*)::int FROM jsonb_array_elements(c.curriculum) s, jsonb_array_elements(s->'lessons')) AS lessons
       FROM certificates ce JOIN users u ON u.id = ce.user_id JOIN courses c ON c.id = ce.course_id
      WHERE ce.id = $1`, [String(id).slice(0, 40)]);
  return rows[0] ? json(rows[0]) : error("Certificate not found", 404);
}

export async function orders(ctx, id) {
  const { query, user, req, url } = ctx;
  if (req.method !== "GET") return error("Method not allowed", 405);
  if (id === undefined) {
    if (url.searchParams.get("all") !== "1" || !ctx.admin) return error("Unauthorized", 401);
    const { rows } = await query(
      "SELECT o.*, u.email, u.name FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 500");
    return json(rows);
  }
  const orderId = idOr404(id);
  if (orderId === null) return error("Not found", 404);
  if (!user) return error("Unauthorized", 401);
  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!rows[0] || (rows[0].user_id !== user.id && !ctx.admin)) return error("Order not found", 404);
  return json(rows[0]);
}
