import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CATEGORIES, SEED_COURSES, SEED_BUNDLES } from "../netlify/lib/seed.mjs";
import { curriculumList, LEVELS, BADGES } from "../netlify/functions/api.mjs";

test("every seed course references a seed category and passes API validation", () => {
  const catIds = new Set(SEED_CATEGORIES.map((c) => c.id));
  for (const c of SEED_COURSES) {
    assert.ok(catIds.has(c.category_id), `${c.title}: unknown category ${c.category_id}`);
    assert.ok(LEVELS.includes(c.level), `${c.title}: level`);
    assert.ok(c.badge == null || BADGES.includes(c.badge), `${c.title}: badge`);
    assert.ok(c.price >= 0 && (c.original_price == null || c.original_price >= c.price), `${c.title}: pricing`);
    assert.ok(c.rating >= 0 && c.rating <= 5, `${c.title}: rating`);
    assert.notEqual(curriculumList(c.curriculum), undefined, `${c.title}: curriculum`);
  }
});

test("seed category colours are hex and slugs are unique", () => {
  const ids = SEED_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of SEED_CATEGORIES) {
    assert.match(c.icon_bg, /^#[0-9A-F]{6}$/i);
    assert.match(c.icon_color, /^#[0-9A-F]{6}$/i);
  }
});

test("seed bundles only reference seed courses and undercut their total", () => {
  const byTitle = new Map(SEED_COURSES.map((c) => [c.title, c]));
  for (const b of SEED_BUNDLES) {
    const courses = b.courses.map((t) => byTitle.get(t));
    assert.ok(courses.every(Boolean), `${b.name}: unknown course`);
    const total = courses.reduce((n, c) => n + c.price, 0);
    assert.ok(b.price < total, `${b.name}: bundle should be cheaper than ${total}`);
  }
});
