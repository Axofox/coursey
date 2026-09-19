/*
  Integration tests: real migrations + real API handler against an isolated
  Postgres. Uses DATABASE_URL when set (CI service container), otherwise
  starts a throwaway embedded Postgres. Nothing here touches production.
*/
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { migrate } from "../../netlify/lib/migrate.mjs";
import { createHandler, resetRateLimits } from "../../netlify/functions/api.mjs";
import { SEED_COURSES, SEED_BUNDLES } from "../../netlify/lib/seed.mjs";

const TOKEN = "integration-token";
let pool, embedded, handler;
const sent = [];
const TEST_STRIPE = { fetchImpl: async () => ({ ok: true, json: async () => ({ id: "cs_test_int", url: "https://checkout.stripe.com/c/cs_test_int" }) }) };

async function connect() {
  if (process.env.DATABASE_URL) return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  embedded = new EmbeddedPostgres({
    databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "coursehub-test-pg-")),
    user: "test", password: "test", port: 54329 + Math.floor(Math.random() * 1000), persistent: false,
    onLog: () => {}, onError: () => {},
  });
  await embedded.initialise();
  await embedded.start();
  const c = embedded.getPgClient();
  return new pg.Pool({ connectionString: `postgresql://test:test@localhost:${c.port}/postgres`, max: 2 });
}

async function resetDb() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

const jars = {}; // named cookie jars: "ana", "maya", ...
function req(method, path, { token, body, as, raw, headers: extra } = {}) {
  const headers = { "x-nf-client-connection-ip": "10.0.0." + Math.floor(Math.random() * 250), ...(extra || {}) };
  if (token) headers.authorization = "Bearer " + token;
  if (as && jars[as]) headers.cookie = jars[as];
  if (body !== undefined && raw === undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost" + path, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
}
async function call(method, path, opts = {}) {
  const res = await handler(req(method, path, opts));
  const setCookie = res.headers.get("set-cookie");
  if (opts.as && setCookie) jars[opts.as] = setCookie.split(";")[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  pool = await connect();
  await resetDb();
  handler = createHandler({ query: (t, p) => pool.query(t, p), mailer: async (m) => { sent.push(m); } });
});
after(async () => {
  await pool.end();
  if (embedded) await embedded.stop();
});

describe("migrations", () => {
  test("apply cleanly on an empty database and seed the catalog", async () => {
    const applied = await migrate(pool);
    assert.deepEqual(applied, ["001-marketplace.sql", "002-bundles-reviews-applications.sql", "003-preview-lessons.sql", "004-accounts.sql", "005-learner-setup.sql", "006-test-course-content.sql"]);
    const { rows: [ux] } = await pool.query("SELECT features, curriculum FROM courses WHERE title = 'UX Foundations: Research to Wireframe'");
    assert.equal(ux.features.learner_setup, true);
    assert.equal(ux.curriculum[1].quiz.length, 4);
    assert.equal(ux.curriculum[3].exercises.length, 3);
    const courses = await pool.query("SELECT count(*)::int AS n FROM courses");
    assert.equal(courses.rows[0].n, SEED_COURSES.length);
    const bundles = await pool.query("SELECT count(*)::int AS n FROM bundles");
    assert.equal(bundles.rows[0].n, SEED_BUNDLES.length);
  });

  test("running again is a no-op and never touches data", async () => {
    await pool.query("UPDATE courses SET title = 'Edited by a human' WHERE id = 1");
    const applied = await migrate(pool);
    assert.deepEqual(applied, []);
    const { rows } = await pool.query("SELECT title FROM courses WHERE id = 1");
    assert.equal(rows[0].title, "Edited by a human");
    await pool.query("UPDATE courses SET title = $1 WHERE id = 1", [SEED_COURSES[0].title]);
  });

  test("a database from the pre-migration-file era is adopted without re-running its migrations", async () => {
    await resetDb();
    // Simulate what the old runtime migrator left behind: v2 tables + meta.schema_version = 2, no preview flags
    await pool.query(await fsp.readFile(new URL("../../migrations/001-marketplace.sql", import.meta.url), "utf8"));
    await pool.query("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '2')");
    await pool.query("INSERT INTO categories (id, name) VALUES ('design', 'Design')");
    await pool.query("INSERT INTO courses (category_id, title, curriculum) VALUES ('design', 'Legacy', $1)", [JSON.stringify([{ title: "S", lessons: [{ title: "L", duration: "1:00" }] }])]);
    const applied = await migrate(pool);
    assert.deepEqual(applied, ["002-bundles-reviews-applications.sql", "003-preview-lessons.sql", "004-accounts.sql", "005-learner-setup.sql", "006-test-course-content.sql"]);
    const { rows } = await pool.query("SELECT curriculum->0->'lessons'->0->>'preview' AS p, title, status, published FROM courses");
    assert.equal(rows.length, 1); // existing data kept, no reseed
    assert.equal(rows[0].title, "Legacy");
    assert.equal(rows[0].p, "true"); // 003 flagged the first lesson
    assert.equal(rows[0].status, "published"); // 004 converted the boolean
    assert.equal(rows[0].published, true);
    await resetDb();
    await migrate(pool);
  });
});

describe("API against the real database", () => {
  before(() => resetRateLimits());

  test("public catalog reads", async () => {
    const cats = await call("GET", "/api/categories");
    assert.equal(cats.status, 200);
    assert.equal(cats.body.find((c) => c.id === "data").course_count, 3);
    const featured = await call("GET", "/api/courses?featured=1");
    assert.equal(featured.body.length, SEED_COURSES.length);
    const search = await call("GET", "/api/courses?q=sql");
    assert.deepEqual(search.body.map((c) => c.title), ["The Complete SQL Bootcamp"]);
    const one = await call("GET", "/api/courses/1");
    assert.equal(one.body.title, SEED_COURSES[0].title);
    assert.equal(one.body.curriculum[0].lessons[0].preview, true);
    assert.equal(typeof one.body.price, "number");
    const stats = await call("GET", "/api/stats");
    assert.equal(stats.body.courses, SEED_COURSES.length);
  });

  test("course lifecycle: create draft → hidden → publish → update → delete", async () => {
    const created = await call("POST", "/api/courses", { token: TOKEN, body: { title: "Integration Course", category_id: "design", price: 19.5, status: "draft", curriculum: [{ title: "S1", lessons: [{ title: "L1", duration: "3:00", preview: true }] }] } });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal((await call("GET", "/api/courses/" + id)).status, 404); // drafts are hidden publicly
    assert.equal((await call("GET", "/api/courses/" + id, { token: TOKEN })).status, 200);
    const all = await call("GET", "/api/courses?all=1", { token: TOKEN });
    assert.ok(all.body.some((c) => c.id === id && c.published === false));
    const published = await call("PUT", "/api/courses/" + id, { token: TOKEN, body: { published: true, title: "Integration Course v2" } });
    assert.equal(published.body.title, "Integration Course v2");
    const pub = await call("GET", "/api/courses/" + id);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.price, 19.5);
    assert.equal(pub.body.lesson_count, undefined); // detail endpoint returns the curriculum itself
    assert.equal(pub.body.curriculum[0].lessons[0].preview, true);
    assert.equal((await call("DELETE", "/api/courses/" + id, { token: TOKEN })).status, 204);
    assert.equal((await call("GET", "/api/courses/" + id, { token: TOKEN })).status, 404);
  });

  test("categories: slug conflict and delete guard", async () => {
    const dup = await call("POST", "/api/categories", { token: TOKEN, body: { name: "Design" } });
    assert.equal(dup.status, 409);
    const guarded = await call("DELETE", "/api/categories/design", { token: TOKEN });
    assert.equal(guarded.status, 409);
    const created = await call("POST", "/api/categories", { token: TOKEN, body: { name: "Music Production", icon_bg: "#FFF6DD", icon_color: "#B79A2E" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.id, "music-production");
    assert.equal((await call("DELETE", "/api/categories/music-production", { token: TOKEN })).status, 204);
  });

  test("accounts: first signup is admin, later ones learners; sessions work via cookie", async () => {
    const admin = await call("POST", "/api/auth/signup", { as: "boss", body: { name: "Sam", email: "sam@example.com", password: "boss-password-1" } });
    assert.equal(admin.status, 201);
    assert.equal(admin.body.role, "admin");
    const ana = await call("POST", "/api/auth/signup", { as: "ana", body: { name: "Ana", email: "ana@example.com", password: "ana-password-1" } });
    assert.equal(ana.body.role, "learner");
    assert.equal((await call("GET", "/api/auth/me", { as: "ana" })).body.email, "ana@example.com");
    assert.equal((await call("GET", "/api/auth/check", { as: "boss" })).status, 204);
    assert.equal((await call("GET", "/api/auth/check", { as: "ana" })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { as: "ana2", body: { email: "ANA@example.com", password: "wrong-password-1" } })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { as: "ana2", body: { email: "ANA@example.com", password: "ana-password-1" } })).status, 200);
    assert.match(sent.find((m) => m.to === "ana@example.com").subject, /Welcome/);
  });

  test("password reset: token from the email works once and logs other sessions out", async () => {
    await call("POST", "/api/auth/forgot", { body: { email: "ana@example.com" } });
    const mail = sent.filter((m) => m.to === "ana@example.com").at(-1);
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(mail.text)[1]);
    assert.equal((await call("POST", "/api/auth/reset", { body: { token, password: "ana-password-2" } })).status, 204);
    assert.equal((await call("POST", "/api/auth/reset", { body: { token, password: "ana-password-3" } })).status, 400); // used
    assert.equal((await call("GET", "/api/auth/me", { as: "ana2" })).body, null); // old session gone
    assert.equal((await call("POST", "/api/auth/login", { as: "ana", body: { email: "ana@example.com", password: "ana-password-2" } })).status, 200);
  });

  test("reviews: signed-in only, pending until approved, then drive the course rating", async () => {
    const before = (await call("GET", "/api/courses/2")).body;
    assert.equal(before.rating, 4.8);
    assert.equal((await call("POST", "/api/reviews", { body: { course_id: 2, rating: 3, body: "Solid but the pandas section drags a little." } })).status, 401);
    const submitted = await call("POST", "/api/reviews", { as: "ana", body: { course_id: 2, rating: 3, body: "Solid but the pandas section drags a little." } });
    assert.equal(submitted.status, 201);
    assert.equal((await call("POST", "/api/reviews", { as: "ana", body: { course_id: 2, rating: 5, body: "Changed my mind, it is great." } })).status, 409);
    const stillManual = (await call("GET", "/api/courses/2")).body;
    assert.equal(stillManual.rating, 4.8);
    assert.equal(stillManual.reviews.length, 0);
    const pending = await call("GET", "/api/reviews?status=pending", { as: "boss" });
    assert.equal(pending.body.length, 1);
    assert.equal(pending.body[0].name, "Ana"); // account name, not a typed one
    await call("PUT", "/api/reviews/" + submitted.body.id, { as: "boss", body: { status: "approved" } });
    const after = (await call("GET", "/api/courses/2")).body;
    assert.equal(after.rating, 3);
    assert.equal(after.rating_count, 1);
    assert.equal(after.reviews[0].verified, false); // not enrolled
    const card = (await call("GET", "/api/courses?q=pandas")).body[0];
    assert.equal(card.rating, 3);
    await call("DELETE", "/api/reviews/" + submitted.body.id, { token: TOKEN });
    assert.equal((await call("GET", "/api/courses/2")).body.rating, 4.8);
  });

  test("checkout prices from the database; the webhook fulfils the order and enrols", async () => {
    const { signPayload } = await import("../../netlify/lib/stripe.mjs");
    process.env.STRIPE_SECRET_KEY = "sk_test_int";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_int";
    handler = createHandler({ query: (t, p) => pool.query(t, p), mailer: async (m) => { sent.push(m); }, stripe: TEST_STRIPE });
    const r = await call("POST", "/api/checkout", { as: "ana", body: { items: [{ kind: "bundle", id: 1, price: 1 }, { kind: "course", id: 1 }] } });
    assert.equal(r.status, 200);
    const { rows: [order] } = await pool.query("SELECT * FROM orders WHERE id = $1", [r.body.order_id]);
    assert.equal(order.amount_cents, 8900 + 4900);
    assert.equal(order.status, "pending");
    assert.equal(order.stripe_session_id, "cs_test_int");
    assert.equal((await call("GET", "/api/courses/1", { as: "ana" })).body.enrolled, false);
    // Stripe calls back
    const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_int", payment_status: "paid", amount_total: 13800, payment_intent: "pi_1", metadata: { order_id: String(order.id), user_id: "2" } } } });
    const wh = await call("POST", "/api/stripe/webhook", { raw: payload, headers: { "stripe-signature": signPayload(payload, "whsec_int") } });
    assert.equal(wh.status, 200);
    const paid = (await call("GET", "/api/orders/" + order.id, { as: "ana" })).body;
    assert.equal(paid.status, "paid");
    const mine = (await call("GET", "/api/me/courses", { as: "ana" })).body;
    assert.deepEqual(mine.map((c) => c.id).sort(), [1, 4, 7]); // bundle 1 = courses 1, 7, 4 — plus course 1 once
    const detail = (await call("GET", "/api/courses/1", { as: "ana" })).body;
    assert.equal(detail.enrolled, true);
    assert.equal((await call("GET", "/api/orders/" + order.id)).status, 401);
    assert.match(sent.at(-1).subject, /purchase/);
    // replaying the webhook is harmless
    await call("POST", "/api/stripe/webhook", { raw: payload, headers: { "stripe-signature": signPayload(payload, "whsec_int") } });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM enrolments WHERE user_id = 2");
    assert.equal(rows[0].n, 3);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  test("learner setup on the flagged course: setup → plan → checkpoint → review → settings change → experiment", async () => {
    // ana is enrolled in course 1 (UX Foundations, flagged) via the bundle purchase above
    assert.equal((await call("GET", "/api/learn/3", { as: "ana" })).status, 404); // not flagged
    assert.equal((await call("GET", "/api/learn/1")).status, 401);
    const detail = (await call("GET", "/api/courses/1", { as: "ana" })).body;
    assert.equal(detail.needs_setup, true);
    assert.equal(detail.curriculum[0].quiz, undefined); // answers never reach learners
    assert.equal(detail.curriculum[0].quiz_count, 4);
    const before = (await call("GET", "/api/learn/1", { as: "ana" })).body;
    assert.equal(before.settings, null);
    assert.equal(before.plan, null);

    const set = await call("PUT", "/api/learn/1/settings", { as: "ana", body: { pace: "sprint", practice: "heavy", track: "job_ready" } });
    assert.equal(set.status, 200);
    const plan = set.body.plan;
    assert.deepEqual([...new Set(plan.map((p) => p.type))].sort(), ["checkpoint", "exercise", "lesson", "review"]);
    const cp0 = plan.find((p) => p.type === "checkpoint" && p.si === 0);
    assert.equal(cp0.questions.length, 4); // heavy: up to 5, the section has 4
    assert.equal(cp0.questions[0].answer, undefined);
    assert.equal(plan.find((p) => p.type === "exercise" && p.si === 0).exercise.track, "job_ready");
    assert.equal(set.body.nudge.tone, "due"); // sprint, nothing done today
    assert.equal((await call("GET", "/api/courses/1", { as: "ana" })).body.needs_setup, false);

    // answer the first checkpoint: all correct except one
    const correct = { 0: 1, 1: 2, 2: 1, 3: 1 }; // from the seed content
    const answers = cp0.questions.map((q) => ({ section_idx: q.section_idx, q_idx: q.q_idx, choice: q.q_idx === 0 ? 0 : correct[q.q_idx] }));
    const graded = await call("POST", "/api/learn/1/quiz", { as: "ana", body: { kind: "checkpoint", section_idx: 0, answers } });
    assert.equal(graded.status, 200);
    assert.equal(graded.body.total, 4);
    assert.equal(graded.body.score, 3); // q_idx 0's answer is 1, we chose 0
    assert.equal(graded.body.state.plan.find((p) => p.type === "checkpoint" && p.si === 0).done, true);
    assert.equal(graded.body.state.nudge.tone, "done"); // activity today
    const review1 = graded.body.state.plan.find((p) => p.type === "review" && p.si === 1);
    assert.equal(review1.questions[0].q_idx, 0); // the wrongly answered question comes back first

    // switch to light practice later: reviews disappear, checkpoints shrink
    const light = (await call("PUT", "/api/learn/1/settings", { as: "ana", body: { pace: "marathon", practice: "light", track: "exploring" } })).body;
    assert.equal(light.plan.some((p) => p.type === "review"), false);
    assert.equal(light.plan.find((p) => p.type === "checkpoint" && p.si === 1).questions.length, 2);
    assert.equal(light.nudge, null);

    await call("POST", "/api/learn/1/exercise", { as: "ana", body: { section_idx: 0 } });
    assert.equal((await call("POST", "/api/events", { as: "ana", body: { name: "setup_viewed", course_id: 1 } })).status, 201);

    const exp = (await call("GET", "/api/experiment", { as: "boss" })).body;
    assert.equal(exp.groups.flagged.courses, 1);
    assert.equal(exp.groups.flagged.enrolments, 1);
    assert.equal(exp.groups.flagged.quiz_attempts, 1);
    assert.ok(exp.groups.control.courses >= 7);
    assert.ok(exp.events.some((e) => e.name === "setup_completed" && e.flag === true && e.n === 1));
    assert.ok(exp.events.some((e) => e.name === "settings_changed"));
    assert.ok(exp.choices.length >= 1);
  });

  test("progress: every lesson done issues a certificate that anyone can verify", async () => {
    const course = (await call("GET", "/api/courses/7", { as: "ana" })).body; // Figma handoff, 6 lessons, enrolled via bundle
    let last;
    course.curriculum.forEach((s, si) => s.lessons.forEach((l, li) => { last = { si, li }; }));
    for (const [si, s] of course.curriculum.entries()) {
      for (const [li] of s.lessons.entries()) {
        const r = await call("POST", "/api/progress", { as: "ana", body: { course_id: 7, section: si, lesson: li } });
        assert.equal(r.status, 200);
        if (si === last.si && li === last.li) assert.ok(r.body.certificate_id, "certificate issued at 100%");
        else assert.equal(r.body.certificate_id, null);
      }
    }
    const mine = (await call("GET", "/api/me/courses", { as: "ana" })).body.find((c) => c.id === 7);
    assert.equal(mine.progress_pct, 100);
    const cert = await call("GET", "/api/certificates/" + mine.certificate_id);
    assert.equal(cert.status, 200);
    assert.equal(cert.body.learner_name, "Ana");
    assert.equal(cert.body.course_title, "Figma to Front-End Handoff");
    assert.equal((await call("POST", "/api/progress", { as: "ana", body: { course_id: 3, section: 0, lesson: 1 } })).status, 402); // not enrolled, not a preview
  });

  test("instructor flow: application approved → role → course pending → admin publishes → live", async () => {
    await call("POST", "/api/auth/signup", { as: "maya", body: { name: "Maya Chen", email: "maya@example.com", password: "maya-password-1" } });
    assert.equal((await call("POST", "/api/courses", { as: "maya", body: { title: "Nope", category_id: "design" } })).status, 401);
    const app = await call("POST", "/api/applications", { as: "maya", body: { expertise: "Design systems", bio: "Ten years at Figma and Airbnb." } });
    assert.equal(app.status, 201);
    await call("PUT", "/api/applications/" + app.body.id, { as: "boss", body: { status: "approved" } });
    assert.equal((await call("GET", "/api/auth/me", { as: "maya" })).body.role, "instructor");
    const created = await call("POST", "/api/courses", { as: "maya", body: { title: "Design Tokens in Practice", category_id: "design", price: 39, published: true, curriculum: [{ title: "S", lessons: [{ title: "L", preview: true }] }] } });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "pending");
    assert.equal(created.body.owner_id, 3);
    assert.equal((await call("GET", "/api/courses/" + created.body.id)).status, 404); // not public yet
    const pending = (await call("GET", "/api/courses?all=1&status=pending", { as: "boss" })).body;
    assert.equal(pending.length, 1);
    await call("PUT", "/api/courses/" + created.body.id, { as: "boss", body: { published: true } });
    assert.equal((await call("GET", "/api/courses/" + created.body.id)).status, 200);
    assert.match(sent.at(-1).subject, /is live/);
    const studio = (await call("GET", "/api/me/instructor", { as: "maya" })).body;
    assert.equal(studio.courses.length, 1);
    assert.equal(studio.gross_cents, 0);
    assert.equal((await call("PUT", "/api/courses/" + created.body.id, { as: "ana", body: { title: "hijack" } })).status, 401);
    assert.equal((await call("DELETE", "/api/courses/" + created.body.id, { as: "maya" })).status, 204);
  });

  test("bundles resolve their courses and skip unpublished ones", async () => {
    const list = await call("GET", "/api/bundles");
    assert.equal(list.status, 200);
    const b = list.body[0];
    assert.equal(b.courses.length, 3);
    assert.equal(b.total_value, 162);
    await call("PUT", "/api/courses/" + b.courses[0].id, { token: TOKEN, body: { published: false } });
    const again = (await call("GET", "/api/bundles/" + b.id)).body;
    assert.equal(again.courses.length, 2);
    await call("PUT", "/api/courses/" + b.courses[0].id, { token: TOKEN, body: { published: true } });
    const created = await call("POST", "/api/bundles", { token: TOKEN, body: { name: "Mini", price: 30, course_ids: [1, 2] } });
    assert.equal(created.status, 201);
    assert.equal(created.body.courses.length, 2);
    assert.equal((await call("DELETE", "/api/bundles/" + created.body.id, { token: TOKEN })).status, 204);
  });

  test("instructor applications flow", async () => {
    const sent = await call("POST", "/api/applications", { body: { name: "Nina", email: "Nina@Example.com", expertise: "Storytelling", bio: "12 years in product marketing." } });
    assert.equal(sent.status, 201);
    const list = await call("GET", "/api/applications", { token: TOKEN });
    assert.equal(list.body[0].email, "nina@example.com");
    assert.equal(list.body[0].status, "new");
    const upd = await call("PUT", "/api/applications/" + sent.body.id, { token: TOKEN, body: { status: "approved" } });
    assert.equal(upd.body.status, "approved");
    assert.equal((await call("DELETE", "/api/applications/" + sent.body.id, { token: TOKEN })).status, 204);
  });

  test("deleting a course cascades its reviews", async () => {
    const c = await call("POST", "/api/courses", { token: TOKEN, body: { title: "Temp", category_id: "design", status: "published" } });
    const r = await call("POST", "/api/reviews", { as: "ana", body: { course_id: c.body.id, rating: 4, body: "Temporary review text." } });
    assert.equal(r.status, 201);
    await call("DELETE", "/api/courses/" + c.body.id, { token: TOKEN });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM reviews WHERE id = $1", [r.body.id]);
    assert.equal(rows[0].n, 0);
  });
});
