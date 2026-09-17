/*
  Integration tests: real migrations + real API handler against an isolated
  Postgres. Uses DATABASE_URL when set (CI service container), otherwise
  starts a throwaway embedded Postgres. Nothing here touches production.
*/
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../netlify/lib/migrate.mjs";
import { createHandler, resetRateLimits } from "../../netlify/functions/api.mjs";
import { SEED_COURSES, SEED_BUNDLES } from "../../netlify/lib/seed.mjs";

const TOKEN = "integration-token";
let pool, embedded, handler;

async function connect() {
  if (process.env.DATABASE_URL) return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  embedded = new EmbeddedPostgres({
    databaseDir: new URL("../../node_modules/.cache/coursehub-test-pg/", import.meta.url).pathname,
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

function req(method, path, { token, body } = {}) {
  const headers = { "x-nf-client-connection-ip": "10.0.0." + Math.floor(Math.random() * 250) };
  if (token) headers.authorization = "Bearer " + token;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(method, path, opts) {
  const res = await handler(req(method, path, opts));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  pool = await connect();
  await resetDb();
  handler = createHandler({ query: (t, p) => pool.query(t, p) });
});
after(async () => {
  await pool.end();
  if (embedded) await embedded.stop();
});

describe("migrations", () => {
  test("apply cleanly on an empty database and seed the catalog", async () => {
    const applied = await migrate(pool);
    assert.deepEqual(applied, ["001-marketplace.sql", "002-bundles-reviews-applications.sql", "003-preview-lessons.sql"]);
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
    await pool.query(await fs.readFile(new URL("../../migrations/001-marketplace.sql", import.meta.url), "utf8"));
    await pool.query("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '2')");
    await pool.query("INSERT INTO categories (id, name) VALUES ('design', 'Design')");
    await pool.query("INSERT INTO courses (category_id, title, curriculum) VALUES ('design', 'Legacy', $1)", [JSON.stringify([{ title: "S", lessons: [{ title: "L", duration: "1:00" }] }])]);
    const applied = await migrate(pool);
    assert.deepEqual(applied, ["002-bundles-reviews-applications.sql", "003-preview-lessons.sql"]);
    const { rows } = await pool.query("SELECT curriculum->0->'lessons'->0->>'preview' AS p, title FROM courses");
    assert.equal(rows.length, 1); // existing data kept, no reseed
    assert.equal(rows[0].title, "Legacy");
    assert.equal(rows[0].p, "true"); // 003 flagged the first lesson
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
    const created = await call("POST", "/api/courses", { token: TOKEN, body: { title: "Integration Course", category_id: "design", price: 19.5, published: false, curriculum: [{ title: "S1", lessons: [{ title: "L1", duration: "3:00", preview: true }] }] } });
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

  test("reviews: pending until approved, then drive the course rating", async () => {
    const before = (await call("GET", "/api/courses/2")).body;
    assert.equal(before.rating, 4.8);
    const submitted = await call("POST", "/api/reviews", { body: { course_id: 2, name: "Ana", rating: 3, body: "Solid but the pandas section drags a little." } });
    assert.equal(submitted.status, 201);
    const stillManual = (await call("GET", "/api/courses/2")).body;
    assert.equal(stillManual.rating, 4.8);
    assert.equal(stillManual.reviews.length, 0);
    const pending = await call("GET", "/api/reviews?status=pending", { token: TOKEN });
    assert.equal(pending.body.length, 1);
    assert.equal(pending.body[0].course_title, "Python for Data Analysis");
    await call("PUT", "/api/reviews/" + submitted.body.id, { token: TOKEN, body: { status: "approved" } });
    const after = (await call("GET", "/api/courses/2")).body;
    assert.equal(after.rating, 3);
    assert.equal(after.rating_count, 1);
    assert.equal(after.reviews[0].name, "Ana");
    const card = (await call("GET", "/api/courses?q=pandas")).body[0];
    assert.equal(card.rating, 3); // list endpoint agrees
    await call("DELETE", "/api/reviews/" + submitted.body.id, { token: TOKEN });
    assert.equal((await call("GET", "/api/courses/2")).body.rating, 4.8);
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
    const c = await call("POST", "/api/courses", { token: TOKEN, body: { title: "Temp", category_id: "design" } });
    const r = await call("POST", "/api/reviews", { body: { course_id: c.body.id, name: "X", rating: 4, body: "Temporary review text." } });
    assert.equal(r.status, 201);
    await call("DELETE", "/api/courses/" + c.body.id, { token: TOKEN });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM reviews WHERE id = $1", [r.body.id]);
    assert.equal(rows[0].n, 0);
  });
});
