import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, pickQuestions, gradeAnswers, streakInfo, nudgeFor, validSettings, reviewSourcesFor } from "../netlify/lib/learn.mjs";
import { handlerWith, call, TOKEN, LEARNER } from "./helpers.mjs";

before(() => { process.env.ADMIN_TOKEN = TOKEN; });

const q = (n, answer = 0) => ({ prompt: "Q" + n, options: ["a", "b", "c"], answer });
const curriculum = [
  { title: "One",   lessons: [{ title: "1a" }, { title: "1b" }], quiz: [q(1), q(2), q(3)], exercises: [{ title: "Ship a deliverable", body: "…", track: "job_ready" }, { title: "Overview notes", body: "…", track: "all" }] },
  { title: "Two",   lessons: [{ title: "2a" }], quiz: [q(4), q(5), q(6), q(7), q(8), q(9)], exercises: [] },
  { title: "Three", lessons: [{ title: "3a" }], quiz: [], exercises: [{ title: "Build it", body: "…", track: "project" }] },
  { title: "Four",  lessons: [{ title: "4a" }], quiz: [q(10)], exercises: [] },
];

describe("plan", () => {
  test("light practice: short checkpoints after each quizzed section, no reviews", () => {
    const steps = buildPlan(curriculum, { pace: "marathon", practice: "light", track: "exploring" });
    const types = steps.map((s) => s.type + s.si);
    assert.deepEqual(types, ["lesson0", "lesson0", "checkpoint0", "exercise0", "lesson1", "checkpoint1", "lesson2", "lesson3", "checkpoint3"]);
    assert.equal(steps.find((s) => s.type === "checkpoint" && s.si === 1).questions.length, 2);
    assert.equal(steps.find((s) => s.type === "exercise").exercise.title, "Overview notes"); // "all" fallback for exploring
    assert.equal(steps.find((s) => s.type === "exercise" && s.si === 2), undefined); // project-only exercise hidden
  });

  test("heavy practice: bigger checkpoints and spaced reviews of earlier sections", () => {
    const steps = buildPlan(curriculum, { pace: "sprint", practice: "heavy", track: "project" });
    const cp1 = steps.find((s) => s.type === "checkpoint" && s.si === 1);
    assert.equal(cp1.questions.length, 5); // capped at 5 of 6
    const reviews = steps.filter((s) => s.type === "review");
    // section 3 reviews one and three back → sections 2 (no quiz, dropped) and 0
    assert.deepEqual(reviews.map((r) => [r.si, r.sources]), [[1, [0]], [2, [1]], [3, [0]]]);
    assert.equal(reviews[2].questions.length, 2);
    assert.deepEqual(reviewSourcesFor(5), [4, 2]);
    assert.equal(steps.find((s) => s.type === "exercise" && s.si === 2).exercise.title, "Build it");
    assert.equal(steps.find((s) => s.type === "exercise" && s.si === 0).exercise.title, "Overview notes"); // project has no own exercise in section 0
  });

  test("done flags come from progress and attempts; questions never carry answers", () => {
    const attempts = [{ kind: "checkpoint", section_idx: 0, answers: [{ section_idx: 0, q_idx: 2, correct: false }, { section_idx: 0, q_idx: 0, correct: true }] }];
    const steps = buildPlan(curriculum, { pace: "marathon", practice: "light", track: "job_ready" }, { progress: ["0-0", "0-x"], attempts });
    assert.equal(steps[0].done, true);
    assert.equal(steps[1].done, false);
    assert.equal(steps.find((s) => s.type === "checkpoint" && s.si === 0).done, true);
    assert.equal(steps.find((s) => s.type === "exercise" && s.si === 0).done, true);
    const cp = steps.find((s) => s.type === "checkpoint" && s.si === 0);
    assert.equal(cp.questions[0].q_idx, 2); // the one answered wrongly comes first
    assert.equal(cp.questions[0].answer, undefined);
  });

  test("pickQuestions: wrong → unseen → correct, then original order", () => {
    const attempts = [{ answers: [{ section_idx: 1, q_idx: 0, correct: true }, { section_idx: 1, q_idx: 3, correct: false }] }];
    const picked = pickQuestions(curriculum[1], 1, 4, attempts).map((x) => x.q_idx);
    assert.deepEqual(picked, [3, 1, 2, 4]);
  });

  test("gradeAnswers ignores unknown questions and scores the rest", () => {
    const g = gradeAnswers(curriculum, [{ section_idx: 0, q_idx: 0, choice: 0 }, { section_idx: 0, q_idx: 1, choice: 2 }, { section_idx: 9, q_idx: 0, choice: 0 }]);
    assert.equal(g.total, 2);
    assert.equal(g.score, 1);
    assert.equal(g.results[1].answer, 0);
  });

  test("validSettings", () => {
    assert.equal(validSettings({ pace: "sprint", practice: "heavy", track: "project" }), true);
    assert.equal(validSettings({ pace: "fast", practice: "heavy", track: "project" }), false);
    assert.equal(validSettings(null), false);
  });
});

describe("pace", () => {
  const day = (offset) => new Date(Date.UTC(2026, 8, 18, 10) + offset * 86400000).toISOString();
  const now = new Date(Date.UTC(2026, 8, 18, 15));
  test("streak counts consecutive days ending today or yesterday", () => {
    assert.deepEqual(streakInfo([day(0), day(-1), day(-2), day(-5)], { now }), { streak: 3, active_today: true, active_days: 4 });
    assert.deepEqual(streakInfo([day(-1), day(-2)], { now }), { streak: 2, active_today: false, active_days: 2 });
    assert.deepEqual(streakInfo([day(-2)], { now }), { streak: 0, active_today: false, active_days: 1 });
    assert.equal(streakInfo([], { now }).streak, 0);
  });
  test("nudges only for sprint, never after completion", () => {
    const s = streakInfo([day(-1)], { now });
    assert.equal(nudgeFor({ pace: "marathon" }, s), null);
    assert.equal(nudgeFor({ pace: "sprint" }, s, { completed: true }), null);
    assert.match(nudgeFor({ pace: "sprint" }, s).text, /1-day streak/);
    assert.equal(nudgeFor({ pace: "sprint" }, streakInfo([day(0)], { now })).tone, "done");
  });
});

describe("learn routes", () => {
  const flagged = { id: 1, title: "T", price: "49", original_price: null, rating: "0", status: "published", published: true, owner_id: null, features: { learner_setup: true }, curriculum, reviews: [] };
  const plain = { ...flagged, id: 2, features: {} };

  test("404 for courses without the flag; 402 when not enrolled; 401 signed out", async () => {
    const { handler } = handlerWith([[/FROM courses c JOIN/, (p) => (p[0] === 1 ? [flagged] : [plain])], [/SELECT id FROM enrolments/, []]]);
    assert.equal((await call(handler, "GET", "/api/learn/1")).status, 401);
    assert.equal((await call(handler, "GET", "/api/learn/2", { as: "learner" })).status, 404);
    assert.equal((await call(handler, "GET", "/api/learn/1", { as: "learner" })).status, 402);
  });

  test("state before setup has no plan; settings PUT validates, upserts and logs setup_completed", async () => {
    const stored = [];
    const { handler, db } = handlerWith([
      [/FROM courses c JOIN/, [flagged]],
      [/SELECT id FROM enrolments/, [{ id: 77 }]],
      [/FROM enrolment_settings WHERE/, () => stored],
      [/INSERT INTO enrolment_settings/, (p) => { stored.push({ pace: p[1], practice: p[2], track: p[3] }); return []; }],
    ]);
    const before = await call(handler, "GET", "/api/learn/1", { as: "learner" });
    assert.equal(before.status, 200);
    assert.equal(before.body.settings, null);
    assert.equal(before.body.plan, null);
    assert.ok(before.body.options.pace.sprint);
    assert.equal((await call(handler, "PUT", "/api/learn/1/settings", { as: "learner", body: { pace: "sprint", practice: "medium", track: "project" } })).status, 400);
    const after = await call(handler, "PUT", "/api/learn/1/settings", { as: "learner", body: { pace: "sprint", practice: "heavy", track: "project" } });
    assert.equal(after.status, 200);
    assert.equal(after.body.settings.practice, "heavy");
    assert.ok(after.body.plan.some((s) => s.type === "review"));
    assert.ok(after.body.nudge);
    const ev = db.calls.find((c) => c.sql.startsWith("INSERT INTO events"));
    assert.equal(ev.params[0], "setup_completed");
    assert.equal(ev.params[1], LEARNER.id);
  });

  test("quiz is graded server-side and recorded", async () => {
    const { handler, db } = handlerWith([
      [/FROM courses c JOIN/, [flagged]],
      [/SELECT id FROM enrolments/, [{ id: 77 }]],
      [/FROM enrolment_settings WHERE/, [{ pace: "marathon", practice: "light", track: "exploring" }]],
    ]);
    const r = await call(handler, "POST", "/api/learn/1/quiz", { as: "learner", body: { section_idx: 0, answers: [{ section_idx: 0, q_idx: 0, choice: 0 }, { section_idx: 0, q_idx: 1, choice: 1 }] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.score, 1);
    assert.equal(r.body.total, 2);
    const ins = db.calls.find((c) => c.sql.startsWith("INSERT INTO quiz_attempts"));
    assert.deepEqual(ins.params.slice(0, 6), [LEARNER.id, 1, 0, "checkpoint", 1, 2]);
    assert.equal((await call(handler, "POST", "/api/learn/1/quiz", { as: "learner", body: { section_idx: 0, answers: [] } })).status, 400);
  });

  test("client events are whitelisted; experiment is admin-only", async () => {
    const { handler } = handlerWith([[/FROM courses c WHERE c\.published/, []], [/FROM enrolment_settings es GROUP/, []], [/FROM events ev/, []]]);
    assert.equal((await call(handler, "POST", "/api/events", { as: "learner", body: { name: "hacked", course_id: 1 } })).status, 400);
    assert.equal((await call(handler, "POST", "/api/events", { as: "learner", body: { name: "setup_viewed", course_id: 1 } })).status, 201);
    assert.equal((await call(handler, "GET", "/api/experiment", { as: "learner" })).status, 401);
    const r = await call(handler, "GET", "/api/experiment", { as: "admin" });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.groups), ["flagged", "control"]);
  });
});
