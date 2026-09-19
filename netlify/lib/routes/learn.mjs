/*
  Learner setup (feature-flagged per course: courses.features.learner_setup).

    GET  /api/learn/:course                 settings (or null), the step plan, streak + nudge, option metadata
    PUT  /api/learn/:course/settings        { pace, practice, track }  — create or change, any time
    POST /api/learn/:course/quiz            { kind: "checkpoint"|"review", section_idx, answers:[{section_idx,q_idx,choice}] }
    POST /api/learn/:course/exercise        { section_idx }  — mark the section's exercise done
    POST /api/events                        { name, course_id?, props? }  — client-side events (whitelisted names)
    GET  /api/experiment                    admin: flagged vs. unflagged courses side by side

  All learn routes require a signed-in, enrolled learner. Courses without the
  flag answer 404 so nothing changes for them.
*/
import { json, error, readBody, bodyError, idOr404 } from "../http.mjs";
import { getCourseRow, isEnrolled } from "./catalog.mjs";
import { PACES, PRACTICES, TRACKS, validSettings, buildPlan, gradeAnswers, streakInfo, nudgeFor } from "../learn.mjs";

const CLIENT_EVENTS = ["setup_viewed", "setup_skipped", "nudge_shown", "plan_viewed"];

export async function logEvent(query, name, { userId = null, courseId = null, props = {} } = {}) {
  await query("INSERT INTO events (name, user_id, course_id, props) VALUES ($1,$2,$3,$4)", [name, userId, courseId, JSON.stringify(props)]);
}
export const flagOn = (course) => !!(course && course.features && course.features.learner_setup);

async function enrolmentFor(query, userId, courseId) {
  const { rows } = await query("SELECT id FROM enrolments WHERE user_id = $1 AND course_id = $2", [userId, courseId]);
  return rows[0] ? rows[0].id : null;
}

async function settingsFor(query, enrolmentId) {
  const { rows } = await query("SELECT pace, practice, track, created_at, updated_at FROM enrolment_settings WHERE enrolment_id = $1", [enrolmentId]);
  return rows[0] || null;
}

async function activity(query, userId, courseId) {
  const [prog, quiz] = await Promise.all([
    query("SELECT section_idx, lesson_idx, completed_at FROM lesson_progress WHERE user_id = $1 AND course_id = $2", [userId, courseId]),
    query("SELECT kind, section_idx, score, total, answers, created_at FROM quiz_attempts WHERE user_id = $1 AND course_id = $2 ORDER BY created_at", [userId, courseId]),
  ]);
  const progress = prog.rows.map((r) => (r.lesson_idx === -1 ? `${r.section_idx}-x` : `${r.section_idx}-${r.lesson_idx}`));
  const dates = [...prog.rows.map((r) => r.completed_at), ...quiz.rows.map((r) => r.created_at)];
  return { progress, attempts: quiz.rows, dates, lessonsDone: prog.rows.filter((r) => r.lesson_idx >= 0).length };
}

async function state(ctx, course, enrolmentId) {
  const settings = await settingsFor(ctx.query, enrolmentId);
  const act = await activity(ctx.query, ctx.user.id, course.id);
  const total = (course.curriculum || []).reduce((n, s) => n + (s.lessons || []).length, 0);
  const completed = total > 0 && act.lessonsDone >= total;
  const streak = streakInfo(act.dates, { tz: ctx.req.headers.get("x-timezone") || "UTC" });
  return {
    course_id: course.id,
    settings,
    plan: settings ? buildPlan(course.curriculum, settings, act) : null,
    streak,
    nudge: nudgeFor(settings, streak, { completed }),
    completed,
    options: { pace: PACES, practice: PRACTICES, track: TRACKS },
  };
}

export async function learn(ctx, id, action) {
  const { query, req, user } = ctx;
  const courseId = idOr404(id);
  if (courseId === null || courseId === undefined) return error("Not found", 404);
  if (!user) return error("Sign in to continue", 401);
  const course = await getCourseRow(query, courseId);
  if (!course || !flagOn(course)) return error("Not found", 404);
  const enrolmentId = await enrolmentFor(query, user.id, courseId);
  if (!enrolmentId) return error("Enrol in this course first", 402);

  if (action === undefined && req.method === "GET") return json(await state(ctx, course, enrolmentId));

  if (action === "settings" && req.method === "PUT") {
    const body = await readBody(req);
    if (!body || body === "too-large") return bodyError(body);
    const s = { pace: body.pace, practice: body.practice, track: body.track };
    if (!validSettings(s)) return error("pace, practice and track must each be one of the offered options", 400);
    const existing = await settingsFor(query, enrolmentId);
    await query(
      `INSERT INTO enrolment_settings (enrolment_id, pace, practice, track) VALUES ($1,$2,$3,$4)
       ON CONFLICT (enrolment_id) DO UPDATE SET pace = EXCLUDED.pace, practice = EXCLUDED.practice, track = EXCLUDED.track, updated_at = now()`,
      [enrolmentId, s.pace, s.practice, s.track]
    );
    await logEvent(query, existing ? "settings_changed" : "setup_completed", { userId: user.id, courseId, props: { ...s, flag: true, from: existing } });
    return json(await state(ctx, course, enrolmentId));
  }

  if (action === "quiz" && req.method === "POST") {
    const body = await readBody(req);
    if (!body || body === "too-large") return bodyError(body);
    const kind = body.kind === "review" ? "review" : "checkpoint";
    const sectionIdx = Number(body.section_idx);
    if (!Number.isInteger(sectionIdx) || !course.curriculum[sectionIdx]) return error("section_idx is required", 400);
    const graded = gradeAnswers(course.curriculum, body.answers);
    if (!graded.total) return error("No answers to grade", 400);
    await query(
      "INSERT INTO quiz_attempts (user_id, course_id, section_idx, kind, score, total, answers) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [user.id, courseId, sectionIdx, kind, graded.score, graded.total, JSON.stringify(graded.results)]
    );
    await logEvent(query, "quiz_completed", { userId: user.id, courseId, props: { kind, section_idx: sectionIdx, score: graded.score, total: graded.total, flag: true } });
    return json({ ...graded, state: await state(ctx, course, enrolmentId) });
  }

  if (action === "exercise" && req.method === "POST") {
    const body = await readBody(req);
    if (!body || body === "too-large") return bodyError(body);
    const sectionIdx = Number(body.section_idx);
    if (!Number.isInteger(sectionIdx) || !course.curriculum[sectionIdx]) return error("section_idx is required", 400);
    await query(
      "INSERT INTO lesson_progress (user_id, course_id, section_idx, lesson_idx) VALUES ($1,$2,$3,-1) ON CONFLICT DO NOTHING",
      [user.id, courseId, sectionIdx]
    );
    await logEvent(query, "exercise_completed", { userId: user.id, courseId, props: { section_idx: sectionIdx, flag: true } });
    return json(await state(ctx, course, enrolmentId));
  }

  return error("Not found", 404);
}

export async function events(ctx) {
  const { query, req, user } = ctx;
  if (req.method !== "POST") return error("Method not allowed", 405);
  if (!user) return error("Unauthorized", 401);
  const body = await readBody(req);
  if (!body || body === "too-large") return bodyError(body);
  if (!CLIENT_EVENTS.includes(body.name)) return error(`name must be one of: ${CLIENT_EVENTS.join(", ")}`, 400);
  const courseId = body.course_id === undefined ? null : Number(body.course_id);
  if (courseId !== null && !Number.isInteger(courseId)) return error("course_id must be a number", 400);
  const props = body.props && typeof body.props === "object" && !Array.isArray(body.props) ? body.props : {};
  await logEvent(query, body.name, { userId: user.id, courseId, props: { ...props, client: true } });
  return json({ ok: true }, 201);
}

/*
  Before/after comparison. Per course and per group (flag on / off):
  enrolments, how many started, how many finished, lessons per enrolment,
  quiz attempts, and setup-choice distribution. Uses the same source tables
  the product runs on, so no separate analytics store is needed.
*/
export async function experiment(ctx) {
  if (ctx.req.method !== "GET") return error("Method not allowed", 405);
  if (!ctx.admin) return error("Unauthorized", 401);
  const { rows: courses } = await ctx.query(`
    SELECT c.id, c.title, (c.features->>'learner_setup')::boolean IS TRUE AS flag,
           (SELECT count(*)::int FROM jsonb_array_elements(c.curriculum) s, jsonb_array_elements(s->'lessons')) AS lessons,
           (SELECT count(*)::int FROM enrolments e WHERE e.course_id = c.id) AS enrolments,
           (SELECT count(DISTINCT lp.user_id)::int FROM lesson_progress lp WHERE lp.course_id = c.id AND lp.lesson_idx >= 0) AS started,
           (SELECT count(*)::int FROM certificates ce WHERE ce.course_id = c.id) AS completed,
           (SELECT count(*)::int FROM lesson_progress lp WHERE lp.course_id = c.id AND lp.lesson_idx >= 0) AS lessons_done,
           (SELECT count(*)::int FROM quiz_attempts qa WHERE qa.course_id = c.id) AS quiz_attempts,
           (SELECT count(*)::int FROM enrolment_settings es JOIN enrolments e ON e.id = es.enrolment_id WHERE e.course_id = c.id) AS setups
      FROM courses c WHERE c.published ORDER BY flag DESC, c.sort_order`);
  const { rows: choices } = await ctx.query(`
    SELECT es.pace, es.practice, es.track, count(*)::int AS n
      FROM enrolment_settings es GROUP BY es.pace, es.practice, es.track ORDER BY n DESC`);
  const { rows: eventCounts } = await ctx.query(`
    SELECT ev.name, (c.features->>'learner_setup')::boolean IS TRUE AS flag, count(*)::int AS n
      FROM events ev LEFT JOIN courses c ON c.id = ev.course_id GROUP BY ev.name, flag ORDER BY ev.name`);
  const group = (flag) => {
    const list = courses.filter((c) => c.flag === flag);
    const sum = (k) => list.reduce((n, c) => n + c[k], 0);
    const enrol = sum("enrolments");
    return {
      courses: list.length, enrolments: enrol, started: sum("started"), completed: sum("completed"),
      start_rate: enrol ? sum("started") / enrol : null,
      completion_rate: enrol ? sum("completed") / enrol : null,
      lessons_per_enrolment: enrol ? sum("lessons_done") / enrol : null,
      quiz_attempts: sum("quiz_attempts"),
    };
  };
  return json({ courses, choices, events: eventCounts, groups: { flagged: group(true), control: group(false) } });
}
