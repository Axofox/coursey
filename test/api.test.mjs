import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { handlerWith, call, TOKEN } from "./helpers.mjs";
import { slugify, curriculumList, parseFields, COURSE_FIELDS, isAuthorized } from "../netlify/functions/api.mjs";

before(() => { process.env.ADMIN_TOKEN = TOKEN; });

describe("auth gate", () => {
  test("public reads need no token", async () => {
    const { handler } = handlerWith([[/FROM categories k/, [{ id: "design", name: "Design", course_count: 2 }]]]);
    const r = await call(handler, "GET", "/api/categories");
    assert.equal(r.status, 200);
    assert.equal(r.body[0].id, "design");
  });

  test("writes without a token are rejected before touching the database", async () => {
    const { handler, db } = handlerWith();
    for (const [m, p] of [["POST", "/api/courses"], ["PUT", "/api/courses/1"], ["DELETE", "/api/categories/x"], ["GET", "/api/reviews"], ["GET", "/api/auth/check"]]) {
      const r = await call(handler, m, p, m === "GET" ? {} : { body: {} });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    assert.equal(db.calls.length, 0);
  });

  test("wrong token and ?all=1 without token are rejected", async () => {
    const { handler } = handlerWith();
    assert.equal((await call(handler, "GET", "/api/auth/check", { token: "nope" })).status, 401);
    assert.equal((await call(handler, "GET", "/api/courses?all=1")).status, 401);
    assert.equal((await call(handler, "GET", "/api/auth/check", { token: TOKEN })).status, 204);
  });

  test("isAuthorized refuses everything when no token is configured", () => {
    const req = new Request("http://x", { headers: { authorization: "Bearer anything" } });
    assert.equal(isAuthorized(req, ""), false);
    assert.equal(isAuthorized(req, undefined), false);
  });

  test("unknown routes and over-deep paths are 404", async () => {
    const { handler } = handlerWith();
    assert.equal((await call(handler, "GET", "/api/nothing")).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/1/extra")).status, 404);
    assert.equal((await call(handler, "GET", "/api/courses/abc")).status, 404);
  });

  test("database errors become a 500 without leaking details", async (t) => {
    t.mock.method(console, "error", () => {}); // the handler logs the real error; keep test output clean
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

  test("admin ?all=1 drops the published filter", async () => {
    const { handler, db } = handlerWith();
    await call(handler, "GET", "/api/courses?all=1", { token: TOKEN });
    assert.doesNotMatch(db.calls[0].sql, /WHERE c\.published/);
  });

  test("numeric columns come back as numbers", async () => {
    const { handler } = handlerWith([[/FROM courses c JOIN/, [{ id: 1, price: "49.00", original_price: "89.00", rating: "4.9", curriculum: [], reviews: [] }]]]);
    const r = await call(handler, "GET", "/api/courses/1");
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 49);
    assert.equal(r.body.original_price, 89);
    assert.equal(r.body.rating, 4.9);
  });

  test("create validates and inserts only known fields", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM categories/, [{ 1: 1 }]],
      [/max\(sort_order\)/, [{ next: 3 }]],
      [/INSERT INTO courses/, [{ id: 42 }]],
      [/FROM courses c JOIN/, [{ id: 42, title: "T", price: "0", original_price: null, rating: "0", curriculum: [], reviews: [] }]],
    ]);
    const r = await call(handler, "POST", "/api/courses", {
      token: TOKEN,
      body: { title: "  T  ", category_id: "design", price: "19.999", level: "Advanced", hacker: "DROP TABLE", learn: ["a", "", "b"] },
    });
    assert.equal(r.status, 201);
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO courses"));
    assert.match(insert.sql, /INSERT INTO courses \(category_id, title, level, price, learn, sort_order\)/);
    assert.deepEqual(insert.params, ["design", "T", "Advanced", 20, JSON.stringify(["a", "b"]), 3]);
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
    ];
    for (const [body, msg] of cases) {
      const r = await call(handler, "POST", "/api/courses", { token: TOKEN, body });
      assert.equal(r.status, 400, JSON.stringify(body));
      if (msg instanceof RegExp) assert.match(r.body.error, msg); else assert.equal(r.body.error, msg);
    }
    assert.equal((await call(handler, "POST", "/api/courses", { token: TOKEN, body: "not json" })).status, 400);
  });

  test("create with unknown category is 404", async () => {
    const { handler } = handlerWith([[/SELECT 1 FROM categories/, []]]);
    const r = await call(handler, "POST", "/api/courses", { token: TOKEN, body: { title: "T", category_id: "ghost" } });
    assert.equal(r.status, 404);
  });

  test("update is partial and bumps updated_at", async () => {
    const { handler, db } = handlerWith([
      [/UPDATE courses/, { rows: [], rowCount: 1 }],
      [/FROM courses c JOIN/, [{ id: 7, price: "1", original_price: null, rating: "0", curriculum: [], reviews: [] }]],
    ]);
    const r = await call(handler, "PUT", "/api/courses/7", { token: TOKEN, body: { published: false } });
    assert.equal(r.status, 200);
    const upd = db.calls.find((c) => c.sql.startsWith("UPDATE courses"));
    assert.equal(upd.sql, "UPDATE courses SET published = $2, updated_at = now() WHERE id = $1");
    assert.deepEqual(upd.params, [7, false]);
    assert.equal((await call(handler, "PUT", "/api/courses/7", { token: TOKEN, body: {} })).status, 400);
  });

  test("delete reports 204 / 404", async () => {
    const { handler } = handlerWith([[/DELETE FROM courses/, (p) => ({ rows: [], rowCount: p[0] === 1 ? 1 : 0 })]]);
    assert.equal((await call(handler, "DELETE", "/api/courses/1", { token: TOKEN })).status, 204);
    assert.equal((await call(handler, "DELETE", "/api/courses/2", { token: TOKEN })).status, 404);
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
  });

  test("delete is refused while courses use the category", async () => {
    const { handler } = handlerWith([[/count\(\*\)::int AS n FROM courses/, [{ n: 3 }]]]);
    const r = await call(handler, "DELETE", "/api/categories/design", { token: TOKEN });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /3 course/);
  });
});

describe("bundles", () => {
  test("public list resolves included courses and total value", async () => {
    const { handler } = handlerWith([
      [/FROM bundles b/, [{ id: 1, name: "B", price: "89.00", course_ids: [1, 2, 99], published: true }]],
      [/FROM courses c JOIN/, [
        { id: 1, price: "49", original_price: null, rating: "4.9" },
        { id: 2, price: "54", original_price: null, rating: "4.8" },
      ]],
    ]);
    const r = await call(handler, "GET", "/api/bundles");
    assert.equal(r.status, 200);
    assert.equal(r.body[0].price, 89);
    assert.deepEqual(r.body[0].courses.map((c) => c.id), [1, 2]); // 99 doesn't exist → skipped
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
  test("anyone can submit; it lands as pending", async () => {
    const { handler, db } = handlerWith([
      [/SELECT 1 FROM courses/, [{ 1: 1 }]],
      [/INSERT INTO reviews/, [{ id: 5, status: "pending" }]],
    ]);
    const r = await call(handler, "POST", "/api/reviews", { body: { course_id: 1, name: "Ana", rating: 5, body: "Really clear and practical." } });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, "pending");
    assert.deepEqual(db.calls.at(-1).params, [1, "Ana", 5, "Really clear and practical."]);
  });

  test("honeypot submissions are silently dropped", async () => {
    const { handler, db } = handlerWith();
    const r = await call(handler, "POST", "/api/reviews", { body: { course_id: 1, name: "Bot", rating: 5, body: "buy now buy now", website: "http://spam" } });
    assert.equal(r.status, 204);
    assert.equal(db.calls.length, 0);
  });

  test("validation", async () => {
    const { handler } = handlerWith([[/SELECT 1 FROM courses/, []]]);
    assert.equal((await call(handler, "POST", "/api/reviews", { body: { course_id: 1, name: "A", rating: 6, body: "long enough text" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/reviews", { body: { course_id: 1, name: "A", rating: 4, body: "short" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/reviews", { body: { course_id: 1, name: "", rating: 4, body: "long enough text" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/reviews", { body: { course_id: 404, name: "A", rating: 4, body: "long enough text" } })).status, 404);
  });

  test("moderation needs the token and a valid status", async () => {
    const { handler, db } = handlerWith([[/UPDATE reviews/, [{ id: 5, status: "approved" }]]]);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { body: { status: "approved" } })).status, 401);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { token: TOKEN, body: { status: "starred" } })).status, 400);
    assert.equal((await call(handler, "PUT", "/api/reviews/5", { token: TOKEN, body: { status: "approved" } })).status, 200);
    assert.equal((await call(handler, "GET", "/api/reviews?status=weird", { token: TOKEN })).status, 400);
    await call(handler, "GET", "/api/reviews?status=pending", { token: TOKEN });
    assert.deepEqual(db.calls.at(-1).params, ["pending"]);
  });
});

describe("instructor applications", () => {
  test("submit validates email and url", async () => {
    const { handler } = handlerWith([[/INSERT INTO instructor_applications/, [{ id: 1, status: "new" }]]]);
    const ok = { name: "Nina", email: "Nina@Example.com", expertise: "Storytelling", portfolio_url: "https://nina.example" };
    assert.equal((await call(handler, "POST", "/api/applications", { body: ok })).status, 201);
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, email: "nope" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, portfolio_url: "nina.example" } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/applications", { body: { ...ok, expertise: "" } })).status, 400);
  });

  test("email is stored lower-cased", async () => {
    const { handler, db } = handlerWith([[/INSERT INTO instructor_applications/, [{ id: 1, status: "new" }]]]);
    await call(handler, "POST", "/api/applications", { body: { name: "N", email: "Nina@Example.com", expertise: "X" } });
    assert.equal(db.calls.at(-1).params[1], "nina@example.com");
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
      { title: "Intro", lessons: [{ title: "Hello", duration: "4:20", video_url: "https://v.example/1", preview: true }] },
      { title: "More", lessons: [{ title: "Bare", duration: "", video_url: "", preview: false }] },
    ]);
    assert.equal(curriculumList("nope"), undefined);
    assert.equal(curriculumList([{ title: "S", lessons: [{ title: "L", video_url: "javascript:alert(1)" }] }]), undefined);
    assert.equal(curriculumList([{ title: "S", lessons: [{ title: "L", duration: "12:75" }] }]), undefined);
  });

  test("parseFields only returns present keys and enforces required on create", () => {
    assert.deepEqual(parseFields(COURSE_FIELDS, { title: "T" }, { creating: false }), { fields: { title: "T" } });
    assert.deepEqual(parseFields(COURSE_FIELDS, { title: "T" }, { creating: true }), { error: "category_id is required" });
    assert.deepEqual(parseFields(COURSE_FIELDS, { original_price: "" }, { creating: false }), { fields: { original_price: null } });
  });
});
