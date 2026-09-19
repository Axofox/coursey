import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { handlerWith, call, TOKEN, LEARNER, INSTRUCTOR } from "./helpers.mjs";
import { slugify, curriculumList, parseFields, COURSE_FIELDS, isAuthorized } from "../netlify/functions/api.mjs";

before(() => { process.env.ADMIN_TOKEN = TOKEN; });

const COURSE_ROW = { id: 1, title: "T", price: "49.00", original_price: "89.00", rating: "4.9", status: "published", published: true, owner_id: null, curriculum: [], reviews: [] };

describe("auth gate", () => {
  test("public reads need no session", async () => {
    const { handler } = handlerWith([[/FROM categories k/, [{ id: "design", name: "Design", course_count: 2 }]]]);
    const r = await call(handler, "GET", "/api/categories");
    assert.equal(r.status, 200);
    assert.equal(r.body[0].id, "design");
  });

  test("writes without a session or token are rejected before touching the database", async () => {
    const { handler, db } = handlerWith();
    for (const [m, p] of [["POST", "/api/courses"], ["PUT", "/api/courses/1"], ["DELETE", "/api/categories/x"], ["GET", "/api/reviews"], ["GET", "/api/auth/check"], ["POST", "/api/reviews"], ["GET", "/api/me/courses"], ["POST", "/api/checkout"]]) {
      const r = await call(handler, m, p, m === "GET" ? {} : { body: {} });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    assert.equal(db.calls.length, 0);
  });

  test("a learner session is not an admin; an admin session and the break-glass token are", async () => {
    const { handler } = handlerWith();
    assert.equal((await call(handler, "GET", "/api/auth/check", { as: "learner" })).status, 401);
    assert.equal((await call(handler, "GET", "/api/auth/check", { as: "admin" })).status, 204);
    assert.equal((await call(handler, "GET", "/api/auth/check", { token: TOKEN })).status, 204);
    assert.equal((await call(handler, "GET", "/api/auth/check", { token: "nope" })).status, 401);
    assert.equal((await call(handler, "GET", "/api/courses?all=1", { as: "learner" })).status, 401);
  });

  test("isAuthorized refuses everything when no token is configured", () => {
    const req = new Request("http://x", { headers: { authorization: "Bearer anything" } });
    assert.equal(isAuthorized(req, ""), false);
    assert.equal(isAuthorized(req, undefined), false);
  });

  test("unknown routes and over-deep paths are 404; health is public", async () => {
    const { handler } = handlerWith();
    assert.equal((await call(handler, "GET", "/api/nothing")).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/1/extra")).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/abc")).status, 404);
    assert.deepEqual((await call(handler, "GET", "/api/health")).body, { ok: true });
  });

  test("database errors become a 500 without leaking details", async (t) => {
    t.mock.method(console, "error", () => {});
    const { handler } = handlerWith([[/./, () => { throw new Error("connection refused: secret host"); }]]);
    const r = await call(handler, "GET", "/api/stats");
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "Server error" });
  });
});

describe("courses", () => {
  test("list builds the right filters", async () => {
    const { handler, db } = handlerWith();
    await call(handler, "GET", "/api/courses?category=data&q=sql&featured=1");
    const { sql, params } = db.calls[0];
    assert.match(sql, /c\.published/);
    assert.match(sql, /c\.category_id = \$1/);
    assert.match(sql, /c\.featured/);
    assert.match(sql, /ILIKE \$2/);
    assert.deepEqual(params, ["data", "%sql%"]);
  });

  test("admin ?all=1 drops the published filter; ?mine=1 scopes to the owner", async () => {
    const { handler, db } = handlerWith();
    await call(handler, "GET", "/api/courses?all=1", { token: TOKEN });
    assert.doesNotMatch(db.calls.at(-1).sql, /WHERE c\.published/);
    await call(handler, "GET", "/api/courses?mine=1", { as: "instructor" });
    assert.match(db.calls.at(-1).sql, /c\.owner_id = \$1/);
    assert.deepEqual(db.calls.at(-1).params, [INSTRUCTOR.id]);
  });

  test("detail: numbers are numbers, locked lessons hide their video link, previews don't", async () => {
    const curriculum = [{ title: "S", lessons: [{ title: "A", preview: true, video_url: "https://v/1" }, { title: "B", preview: false, video_url: "https://v/2" }] }];
    const { handler } = handlerWith([[/FROM courses c JOIN/, [{ ...COURSE_ROW, curriculum }]], [/FROM enrolments WHERE/, []]]);
    const r = await call(handler, "GET", "/api/courses/1");
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 49);
    assert.equal(r.body.original_price, 89);
    assert.equal(r.body.rating, 4.9);
    assert.equal(r.body.enrolled, false);
    assert.equal(r.body.curriculum[0].lessons[0].video_url, "https://v/1");
    assert.equal(r.body.curriculum[0].lessons[1].video_url, "locked");
  });

  test("detail: enrolled learners get every link and their progress", async () => {
    const curriculum = [{ title: "S", lessons: [{ title: "B", preview: false, video_url: "https://v/2" }] }];
    const { handler } = handlerWith([
      [/FROM courses c JOIN/, [{ ...COURSE_ROW, curriculum }]],
      [/SELECT 1 FROM enrolments/, [{ 1: 1 }]],
      [/FROM lesson_progress/, [{ section_idx: 0, lesson_idx: 0 }]],
    ]);
    const r = await call(handler, "GET", "/api/courses/1", { as: "learner" });
    assert.equal(r.body.enrolled, true);
    assert.equal(r.body.curriculum[0].lessons[0].video_url, "https://v/2");
    assert.deepEqual(r.body.progress, ["0-0"]);
  });

  test("drafts are hidden from the public but visible to the owner", async () => {
    const draft = { ...COURSE_ROW, status: "draft", published: false, owner_id: INSTRUCTOR.id };
    const { handler } = handlerWith([[/FROM courses c JOIN/, [draft]]]);
    assert.equal((await call(handler, "GET", "/api/courses/1")).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/1", { as: "learner" })).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/1", { as: "instructor" })).status, 200);
    assert.equal((await call(handler, "GET", "/api/courses/1", { as: "admin" })).status, 200);
  });

  test("admin create validates and inserts only known fields", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM categories/, [{ 1: 1 }]],
      [/max\(sort_order\)/, [{ next: 3 }]],
      [/INSERT INTO courses/, [{ id: 42 }]],
      [/FROM courses c JOIN/, [{ ...COURSE_ROW, id: 42 }]],
    ]);
    const r = await call(handler, "POST", "/api/courses", {
      token: TOKEN,
      body: { title: "  T  ", category_id: "design", price: "19.999", level: "Advanced", hacker: "DROP TABLE", learn: ["a", "", "b"], published: true },
    });
    assert.equal(r.status, 201);
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO courses"));
    assert.match(insert.sql, /INSERT INTO courses \(category_id, title, level, price, learn, status, sort_order\)/);
    assert.deepEqual(insert.params, ["design", "T", "Advanced", 20, JSON.stringify(["a", "b"]), "published", 3]);
  });

  test("instructor create is owned by them, never featured, and 'published' becomes 'pending'", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM categories/, [{ 1: 1 }]],
      [/max\(sort_order\)/, [{ next: 0 }]],
      [/INSERT INTO courses/, [{ id: 7 }]],
      [/FROM courses c JOIN/, [{ ...COURSE_ROW, id: 7, owner_id: INSTRUCTOR.id }]],
    ]);
    const r = await call(handler, "POST", "/api/courses", { as: "instructor", body: { title: "Mine", category_id: "design", featured: true, published: true } });
    assert.equal(r.status, 201);
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO courses"));
    assert.match(insert.sql, /owner_id/);
    assert.doesNotMatch(insert.sql, /featured/);
    assert.ok(insert.params.includes("pending"));
    assert.ok(insert.params.includes(INSTRUCTOR.id));
    assert.equal((await call(handler, "POST", "/api/courses", { as: "learner", body: { title: "x", category_id: "design" } })).status, 401);
  });

  test("create rejects bad input with a specific message", async () => {
    const { handler } = handlerWith();
    const cases = [
      [{ category_id: "x" }, "title is required"],
      [{ title: "T" }, "category_id is required"],
      [{ title: "T", category_id: "x", level: "Guru" }, "level must be one of: Beginner, Intermediate, Advanced"],
      [{ title: "T", category_id: "x", price: -1 }, "price must be a number ≥ 0"],
      [{ title: "T", category_id: "x", badge: "Hot" }, "badge must be one of: Bestseller, New or empty"],
      [{ title: "T", category_id: "x", rating: 7 }, "rating must be 0–5"],
      [{ title: "T", category_id: "x", curriculum: [{ title: "S", lessons: [{ title: "L", duration: "1:99" }] }] }, /curriculum must be/],
      [{ title: "T", category_id: "x", featured: "yes" }, "featured must be true/false"],
      [{ title: "T", category_id: "x", status: "live" }, /status must be one of/],
    ];
    for (const [body, msg] of cases) {
      const r = await call(handler, "POST", "/api/courses", { token: TOKEN, body });
      assert.equal(r.status, 400, JSON.stringify(body));
      if (msg instanceof RegExp) assert.match(r.body.error, msg); else assert.equal(r.body.error, msg);
    }
    assert.equal((await call(handler, "POST", "/api/courses", { token: TOKEN, body: "not json" })).status, 400);
  });

  test("update is partial, owner-checked, and bumps updated_at", async () => {
    const owned = { ...COURSE_ROW, id: 7, owner_id: INSTRUCTOR.id, status: "draft", published: false };
    const { handler, db } = handlerWith([[/FROM courses c JOIN/, [owned]], [/UPDATE courses/, { rows: [], rowCount: 1 }]]);
    assert.equal((await call(handler, "PUT", "/api/courses/7", { as: "learner", body: { title: "x" } })).status, 401);
    const r = await call(handler, "PUT", "/api/courses/7", { as: "instructor", body: { title: "New", published: true } });
    assert.equal(r.status, 200);
    const upd = db.calls.find((c) => c.sql.startsWith("UPDATE courses"));
    assert.equal(upd.sql, "UPDATE courses SET title = $2, status = $3, updated_at = now() WHERE id = $1");
    assert.deepEqual(upd.params, [7, "New", "pending"]); // instructors can only submit for review
    assert.equal((await call(handler, "PUT", "/api/courses/7", { token: TOKEN, body: {} })).status, 400);
  });

  test("delete: owner or admin only", async () => {
    const owned = { ...COURSE_ROW, id: 7, owner_id: INSTRUCTOR.id };
    const { handler } = handlerWith([[/FROM courses c JOIN/, (p) => (p[0] === 7 ? [owned] : [])], [/DELETE FROM courses/, { rows: [], rowCount: 1 }]]);
    assert.equal((await call(handler, "DELETE", "/api/courses/7", { as: "learner" })).status, 401);
    assert.equal((await call(handler, "DELETE", "/api/courses/7", { as: "instructor" })).status, 204);
    assert.equal((await call(handler, "DELETE", "/api/courses/8", { token: TOKEN })).status, 404);
  });
});

describe("categories", () => {
  test("create slugifies the name and refuses duplicates", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM categories/, (p) => (p[0] === "music-production" ? [] : [{ 1: 1 }])],
      [/max\(sort_order\)/, [{ next: 6 }]],
      [/FROM categories k/, [{ id: "music-production", name: "Music Production", course_count: 0 }]],
    ]);
    const r = await call(handler, "POST", "/api/categories", { token: TOKEN, body: { name: " Music Production! " } });
    assert.equal(r.status, 201);
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO categories"));
    assert.deepEqual(insert.params.slice(0, 2), ["music-production", "Music Production!"]);
    assert.equal((await call(handler, "POST", "/api/categories", { token: TOKEN, body: { name: "Design" } })).status, 409);
    assert.equal((await call(handler, "POST", "/api/categories", { token: TOKEN, body: { name: "!!!" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/categories", { token: TOKEN, body: { name: "X", icon_bg: "red" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/categories", { as: "instructor", body: { name: "X" } })).status, 401);
  });

  test("delete is refused while courses use the category", async () => {
    const { handler } = handlerWith([[/count\(\*\)::int AS n FROM courses/, [{ n: 3 }]]]);
    const r = await call(handler, "DELETE", "/api/categories/design", { as: "admin" });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /3 course/);
  });
});

describe("bundles", () => {
  test("public list resolves included courses and total value", async () => {
    const { handler } = handlerWith([
      [/FROM bundles b/, [{ id: 1, name: "B", price: "89.00", course_ids: [1, 2, 99], published: true }]],
      [/FROM courses c JOIN/, [{ id: 1, price: "49", original_price: null, rating: "4.9" }, { id: 2, price: "54", original_price: null, rating: "4.8" }]],
    ]);
    const r = await call(handler, "GET", "/api/bundles");
    assert.equal(r.status, 200);
    assert.equal(r.body[0].price, 89);
    assert.deepEqual(r.body[0].courses.map((c) => c.id), [1, 2]);
    assert.equal(r.body[0].total_value, 103);
  });

  test("create validates course ids", async () => {
    const { handler } = handlerWith();
    const r = await call(handler, "POST", "/api/bundles", { token: TOKEN, body: { name: "B", course_ids: [1, "x"] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /course_ids/);
  });
});

describe("reviews", () => {
  test("a signed-in learner submits; it lands as pending with their account name and verified flag", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM courses/, [{ 1: 1 }]],
      [/SELECT 1 FROM reviews WHERE/, []],
      [/SELECT 1 FROM enrolments/, [{ 1: 1 }]],
      [/INSERT INTO reviews/, [{ id: 5, status: "pending" }]],
    ]);
    const r = await call(handler, "POST", "/api/reviews", { as: "learner", body: { course_id: 1, name: "Spoofed", rating: 5, body: "Really clear and practical." } });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, "pending");
    assert.deepEqual(db.calls.at(-1).params, [1, LEARNER.id, "Ana", 5, "Really clear and practical.", true]);
  });

  test("one review per learner per course; validation", async () => {
    const { handler } = handlerWith([[/SELECT 1 FROM courses/, (p) => (p[0] === 404 ? [] : [{ 1: 1 }])], [/SELECT 1 FROM reviews WHERE/, [{ 1: 1 }]]]);
    assert.equal((await call(handler, "POST", "/api/reviews", { as: "learner", body: { course_id: 1, rating: 4, body: "long enough text here" } })).status, 409);
    assert.equal((await call(handler, "POST", "/api/reviews", { as: "learner", body: { course_id: 1, rating: 6, body: "long enough text" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/reviews", { as: "learner", body: { course_id: 1, rating: 4, body: "short" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/reviews", { as: "learner", body: { course_id: 404, rating: 4, body: "long enough text" } })).status, 404);
  });

  test("moderation needs admin and a valid status", async () => {
    const { handler, db } = handlerWith([[/UPDATE reviews/, [{ id: 5, status: "approved" }]]]);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { as: "learner", body: { status: "approved" } })).status, 401);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { as: "admin", body: { status: "starred" } })).status, 400);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { as: "admin", body: { status: "approved" } })).status, 200);
    assert.equal((await call(handler, "GET", "/api/reviews?status=weird", { token: TOKEN })).status, 400);
    await call(handler, "GET", "/api/reviews?status=pending", { token: TOKEN });
    assert.deepEqual(db.calls.at(-1).params, ["pending"]);
  });
});

describe("instructor applications", () => {
  test("submit validates email and url; honeypot drops silently", async () => {
    const { handler, db } = handlerWith([[/INSERT INTO instructor_applications/, [{ id: 1, status: "new" }]]]);
    const ok = { name: "Nina", email: "Nina@Example.com", expertise: "Storytelling", portfolio_url: "https://nina.example" };
    assert.equal((await call(handler, "POST", "/api/applications", { body: ok })).status, 201);
    assert.equal(db.calls.at(-1).params[1], "nina@example.com");
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, email: "nope" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, portfolio_url: "nina.example" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, expertise: "" } })).status, 400);
    const n = db.calls.length;
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, website: "http://spam" } })).status, 204);
    assert.equal(db.calls.length, n);
  });

  test("approving promotes the matching account and emails them", async () => {
    const { handler, sent } = handlerWith([
      [/UPDATE instructor_applications/, [{ id: 1, status: "approved", name: "Nina", email: "nina@example.com", user_id: null }]],
      [/UPDATE users SET role = 'instructor'/, [{ id: 9 }]],
    ]);
    const r = await call(handler, "PUT", "/api/applications/1", { as: "admin", body: { status: "approved" } });
    assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "nina@example.com");
    assert.match(sent[0].subject, /approved/);
  });
});

describe("accounts", () => {
  test("signup: validation, first account becomes admin, sets a session cookie, sends welcome", async () => {
    const { handler, db, sent } = handlerWith([
      [/SELECT 1 FROM users WHERE lower/, []],
      [/count\(\*\)::int AS n FROM users/, [{ n: 0 }]],
      [/INSERT INTO users/, (p) => [{ id: 1, email: p[0], name: p[1], role: p[3], created_at: "now" }]],
    ]);
    assert.equal((await call(handler, "POST", "/api/auth/signup", { body: { name: "A", email: "a@b.co", password: "short" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/auth/signup", { body: { name: "A", email: "nope", password: "longenough12" } })).status, 400);
    const res = await handler(new Request("http://localhost/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada", email: "Ada@Example.com", password: "correct-horse-1" }) }));
    assert.equal(res.status, 201);
    const cookie = res.headers.get("set-cookie");
    assert.match(cookie, /^ch_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const body = await res.json();
    assert.equal(body.role, "admin");
    assert.equal(body.password_hash, undefined);
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO users"));
    assert.equal(insert.params[0], "ada@example.com");
    assert.match(insert.params[2], /^scrypt\$16384\$/);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent[0].subject, "Welcome to Coursehub");
  });

  test("signup refuses duplicate emails; login checks the password", async () => {
    const { hashPassword } = await import("../netlify/lib/auth.mjs");
    const hash = await hashPassword("correct-horse-1");
    const { handler } = handlerWith([
      [/SELECT 1 FROM users WHERE lower/, [{ 1: 1 }]],
      [/SELECT \* FROM users WHERE lower/, (p) => (p[0] === "ada@example.com" ? [{ id: 5, email: "ada@example.com", name: "Ada", role: "learner", password_hash: hash }] : [])],
    ]);
    assert.equal((await call(handler, "POST", "/api/auth/signup", { body: { name: "A", email: "ada@example.com", password: "correct-horse-1" } })).status, 409);
    assert.equal((await call(handler, "POST", "/api/auth/login", { body: { email: "ada@example.com", password: "wrong-horse-1" } })).status, 401);
    assert.equal((await call(handler, "POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "correct-horse-1" } })).status, 401);
    const ok = await call(handler, "POST", "/api/auth/login", { body: { email: "ADA@example.com", password: "correct-horse-1" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.name, "Ada");
  });

  test("forgot never reveals whether an account exists; reset consumes the token and revokes sessions", async () => {
    const { handler, db, sent } = handlerWith([
      [/SELECT \* FROM users WHERE lower/, (p) => (p[0] === "ada@example.com" ? [{ id: 5, email: "ada@example.com", name: "Ada" }] : [])],
      [/UPDATE password_resets SET used_at = now\(\)\s+WHERE token_hash/, (p) => (p[0] ? [{ user_id: 5 }] : [])],
    ]);
    assert.equal((await call(handler, "POST", "/api/auth/forgot", { body: { email: "nobody@example.com" } })).status, 204);
    assert.equal((await call(handler, "POST", "/api/auth/forgot", { body: { email: "ada@example.com" } })).status, 204);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /reset\.html\?token=/);
    assert.equal((await call(handler, "POST", "/api/auth/reset", { body: { token: "t", password: "weak" } })).status, 400);
    const r = await call(handler, "POST", "/api/auth/reset", { body: { token: "some-token", password: "new-horse-123" } });
    assert.equal(r.status, 204);
    assert.ok(db.calls.some((c) => c.sql.startsWith("DELETE FROM sessions WHERE user_id")));
  });

  test("me / logout / password change", async () => {
    const { hashPassword } = await import("../netlify/lib/auth.mjs");
    LEARNER.password_hash = await hashPassword("old-horse-123");
    const { handler, db } = handlerWith([[/UPDATE users SET name/, [{ ...LEARNER, name: "Ana B." }]]]);
    const anon = await call(handler, "GET", "/api/auth/me");
    assert.equal(anon.status, 200);
    assert.equal(anon.body, null);
    assert.equal((await call(handler, "GET", "/api/auth/me", { as: "learner" })).body.email, "ana@example.com");
    assert.equal((await call(handler, "PUT", "/api/auth/me", { as: "learner", body: { name: "Ana B." } })).body.name, "Ana B.");
    assert.equal((await call(handler, "PUT", "/api/auth/password", { as: "learner", body: { current: "nope", password: "new-horse-123" } })).status, 401);
    assert.equal((await call(handler, "PUT", "/api/auth/password", { as: "learner", body: { current: "old-horse-123", password: "new-horse-123" } })).status, 204);
    const out = await handler(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: "ch_session=sess-learner" } }));
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
    assert.ok(db.calls.some((c) => c.sql.startsWith("DELETE FROM sessions WHERE token_hash")));
  });

  test("admin user management", async () => {
    const { handler } = handlerWith([[/UPDATE users SET role/, [{ ...LEARNER, role: "instructor" }]]]);
    assert.equal((await call(handler, "GET", "/api/users", { as: "learner" })).status, 401);
    assert.equal((await call(handler, "PUT", "/api/users/2", { as: "admin", body: { role: "boss" } })).status, 400);
    assert.equal((await call(handler, "PUT", "/api/users/2", { as: "admin", body: { role: "instructor" } })).body.role, "instructor");
    assert.equal((await call(handler, "PUT", "/api/users/1", { as: "admin", body: { role: "learner" } })).status, 400); // not yourself
  });
});

describe("checkout", () => {
  const courseRows = [{ id: 1, title: "A", price: "49.00", original_price: null, rating: "0" }, { id: 2, title: "B", price: "0", original_price: null, rating: "0" }];
  test("prices come from the database, owned courses are skipped, empty carts refused", async () => {
    const { handler, db } = handlerWith([
      [/FROM courses c JOIN/, courseRows],
      [/SELECT course_id FROM enrolments/, [{ course_id: 2 }]],
      [/INSERT INTO orders/, (p) => [{ id: 10, user_id: LEARNER.id, amount_cents: p[1], items: JSON.parse(p[2]), status: "pending" }]],
    ]);
    const stripe = { fetchImpl: async () => ({ ok: true, json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" }) }) };
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { handler: h2 } = handlerWith([
      [/FROM courses c JOIN/, courseRows],
      [/SELECT course_id FROM enrolments/, [{ course_id: 2 }]],
      [/INSERT INTO orders/, (p) => [{ id: 10, user_id: LEARNER.id, amount_cents: p[1], items: JSON.parse(p[2]), status: "pending" }]],
    ], { stripe });
    const r = await call(h2, "POST", "/api/checkout", { as: "learner", body: { items: [{ kind: "course", id: 1, price: 0.01 }, { kind: "course", id: 2 }] } });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /checkout\.stripe\.com/);
    assert.equal((await call(handler, "POST", "/api/checkout", { as: "learner", body: { items: [] } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/checkout", { as: "learner", body: { items: [{ kind: "course", id: 2 }] } })).status, 400); // only owned
    delete process.env.STRIPE_SECRET_KEY;
  });

  test("a fully free order is fulfilled immediately without Stripe", async () => {
    const { handler, db, sent } = handlerWith([
      [/FROM courses c JOIN/, [courseRows[1]]],
      [/SELECT course_id FROM enrolments/, []],
      [/INSERT INTO orders/, (p) => [{ id: 11, user_id: LEARNER.id, amount_cents: 0, items: JSON.parse(p[2]), status: "pending" }]],
      [/SELECT \* FROM users WHERE id/, [LEARNER]],
    ]);
    const r = await call(handler, "POST", "/api/checkout", { as: "learner", body: { items: [{ kind: "course", id: 2 }] } });
    assert.equal(r.status, 200);
    assert.match(r.body.url, /checkout-success\.html\?order=11/);
    assert.ok(db.calls.some((c) => c.sql.startsWith("INSERT INTO enrolments")));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent[0].subject, "Your Coursehub purchase");
  });

  test("webhook: bad signature rejected, valid completed session fulfils once, amount mismatch ignored", async () => {
    const { signPayload } = await import("../netlify/lib/stripe.mjs");
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const order = { id: 10, user_id: LEARNER.id, amount_cents: 4900, items: [{ kind: "course", id: 1, title: "A", price_cents: 4900, course_ids: [1] }], status: "pending" };
    const { handler, db } = handlerWith([[/SELECT \* FROM orders WHERE id/, [order]], [/SELECT \* FROM users WHERE id/, [LEARNER]]]);
    const event = (amount) => JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: amount, metadata: { order_id: "10" }, payment_intent: "pi_1" } } });
    const post = (raw, sig) => handler(new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body: raw }));
    assert.equal((await post(event(4900), "t=1,v1=bad")).status, 400);
    const ok = await post(event(4900), signPayload(event(4900), "whsec_test"));
    assert.equal(ok.status, 200);
    assert.ok(db.calls.some((c) => c.sql.startsWith("UPDATE orders SET status = 'paid'")));
    const mismatch = await post(event(100), signPayload(event(100), "whsec_test"));
    assert.equal((await mismatch.json()).ignored, "amount mismatch");
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});

describe("abuse protection", () => {
  test("public submissions are rate limited per IP", async () => {
    const { handler } = handlerWith([[/INSERT INTO instructor_applications/, [{ id: 1, status: "new" }]]]);
    const body = { name: "A", email: "a@b.co", expertise: "X" };
    const mk = (ip) => new Request("http://x/api/applications", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip }, body: JSON.stringify(body) });
    let last;
    for (let i = 0; i < 11; i++) last = await handler(mk("1.2.3.4"));
    assert.equal(last.status, 429);
    assert.equal((await handler(mk("5.6.7.8"))).status, 201);
  });

  test("repeated bad tokens and login attempts are rate limited, reads are not", async () => {
    const { handler } = handlerWith();
    let last;
    for (let i = 0; i < 21; i++) last = await call(handler, "GET", "/api/auth/check", { token: "guess" + i });
    assert.equal(last.status, 429);
    assert.equal((await call(handler, "GET", "/api/categories")).status, 200);
    const { handler: h2 } = handlerWith();
    for (let i = 0; i < 21; i++) last = await call(h2, "POST", "/api/auth/login", { body: { email: "a@b.co", password: "x" } });
    assert.equal(last.status, 429);
  });

  test("oversized bodies are refused with 413", async () => {
    const { handler, db } = handlerWith();
    const big = { title: "x".repeat(70 * 1024), category_id: "design" };
    const r = await call(handler, "POST", "/api/courses", { token: TOKEN, body: big });
    assert.equal(r.status, 413);
    assert.equal(db.calls.length, 0);
    assert.equal((await call(handler, "POST", "/api/courses", { token: TOKEN, body: "[1,2]" })).status, 400);
  });
});

describe("pure helpers", () => {
  test("slugify", () => {
    assert.equal(slugify("  Music & Production!  "), "music-production");
    assert.equal(slugify("---"), "");
  });

  test("curriculumList normalises, drops blanks and flags previews", () => {
    const out = curriculumList([
      { title: " Intro ", lessons: [{ title: "Hello", duration: "4:20", video_url: "https://v.example/1", preview: true }, { title: "" }] },
      { title: "", lessons: [] },
      { title: "More", lessons: [{ title: "Bare" }] },
    ]);
    assert.deepEqual(out, [
      { title: "Intro", lessons: [{ title: "Hello", duration: "4:20", video_url: "https://v.example/1", preview: true }], quiz: [], exercises: [] },
      { title: "More", lessons: [{ title: "Bare", duration: "", video_url: "", preview: false }], quiz: [], exercises: [] },
    ]);
    // checkpoint questions and track-tagged exercises are validated too
    const rich = curriculumList([{ title: "S", lessons: [], quiz: [{ prompt: "Q?", options: ["a", "b"], answer: 1 }], exercises: [{ title: "Do it", body: "…", track: "job_ready" }] }]);
    assert.equal(rich[0].quiz[0].answer, 1);
    assert.equal(rich[0].exercises[0].track, "job_ready");
    assert.equal(curriculumList([{ title: "S", lessons: [], quiz: [{ prompt: "Q?", options: ["a"], answer: 0 }] }]), undefined); // one option
    assert.equal(curriculumList([{ title: "S", lessons: [], quiz: [{ prompt: "Q?", options: ["a", "b"], answer: 5 }] }]), undefined); // answer out of range
    assert.equal(curriculumList([{ title: "S", lessons: [], exercises: [{ title: "X", track: "vip" }] }]), undefined); // unknown track
    assert.equal(curriculumList("nope"), undefined);
    assert.equal(curriculumList([{ title: "S", lessons: [{ title: "L", video_url: "javascript:alert(1)" }] }]), undefined);
    assert.equal(curriculumList([{ title: "S", lessons: [{ title: "L", duration: "12:75" }] }]), undefined);
  });

  test("parseFields only returns present keys and enforces required on create", () => {
    assert.deepEqual(parseFields(COURSE_FIELDS, { title: "T" }, { creating: false }), { fields: { title: "T" } });
    assert.deepEqual(parseFields(COURSE_FIELDS, { title: "T" }, { creating: true }), { error: "category_id is required" });
    assert.deepEqual(parseFields(COURSE_FIELDS, { original_price: "" }, { creating: false }), { fields: { original_price: null } });
  });

  test("password rules and hashing round-trip", async () => {
    const { hashPassword, verifyPassword, passwordProblem } = await import("../netlify/lib/auth.mjs");
    assert.notEqual(passwordProblem("short1"), "");
    assert.notEqual(passwordProblem("onlyletters"), "");
    assert.equal(passwordProblem("letters-and-1"), "");
    const h = await hashPassword("letters-and-1");
    assert.equal(await verifyPassword("letters-and-1", h), true);
    assert.equal(await verifyPassword("letters-and-2", h), false);
    assert.equal(await verifyPassword("x", "garbage"), false);
  });
});
