// public/assets/api.js is a browser IIFE; run it in a sandbox with the few globals it touches.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadCoursehub() {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = {
    window: {},
    document: { addEventListener() {}, querySelectorAll: () => [] },
    localStorage: storage,
    sessionStorage: storage,
    fetch: async () => { throw new Error("no network in tests"); },
    Number, String, JSON, Math, Object, Array, Map, Set, encodeURIComponent, URLSearchParams,
  };
  sandbox.window.location = { search: "?id=7&q=sql" };
  sandbox.window.localStorage = storage;
  vm.runInNewContext(fs.readFileSync(new URL("../public/assets/api.js", import.meta.url), "utf8"), sandbox);
  sandbox.window.Coursehub._storage = storage;
  return sandbox.window.Coursehub;
}

const H = loadCoursehub();
const localStorage = H._storage;

describe("formatting", () => {
  test("money drops cents only when whole", () => {
    assert.equal(H.money(49), "$49");
    assert.equal(H.money("49.00"), "$49");
    assert.equal(H.money(19.5), "$19.50");
  });
  test("num uses thousands separators", () => {
    assert.equal(H.num(18240), "18,240");
    assert.equal(H.num(undefined), "0");
  });
  test("initials", () => {
    assert.equal(H.initials("Maya Chen"), "MC");
    assert.equal(H.initials("  priya  "), "P");
    assert.equal(H.initials(""), "?");
  });
  test("esc neutralises HTML", () => {
    assert.equal(H.esc('<b onclick="x">&\'</b>'), "&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;");
    assert.equal(H.esc(null), "");
  });
});

describe("durations", () => {
  test("durationSeconds parses m:ss and bare minutes", () => {
    assert.equal(H.durationSeconds("4:20"), 260);
    assert.equal(H.durationSeconds("12"), 720);
    assert.equal(H.durationSeconds(""), 0);
  });
  test("formatDuration", () => {
    assert.equal(H.formatDuration(260), "4m");
    assert.equal(H.formatDuration(3600), "1h");
    assert.equal(H.formatDuration(3660), "1h 01m");
    assert.equal(H.formatDuration(11 * 3600 + 20 * 60), "11h 20m");
  });
  test("curriculumTotals sums sections", () => {
    const t = H.curriculumTotals([
      { title: "A", lessons: [{ duration: "10:00" }, { duration: "5:30" }] },
      { title: "B", lessons: [{ duration: "44:30" }] },
    ]);
    // objects cross the vm boundary with a different Object prototype, so compare by value
    assert.deepEqual(JSON.parse(JSON.stringify(t)), { sections: 2, lessons: 3, seconds: 3600, label: "1h" });
    assert.equal(H.curriculumTotals(undefined).lessons, 0);
  });
});

describe("course card", () => {
  const base = { id: 3, title: "T", instructor_name: "I", icon_bg: "#EDEBFB", icon_color: "#7A6DF0", price: 49, original_price: 89, rating: 4.9, rating_count: 2104, badge: "Bestseller" };
  test("renders price, strike-through, rating and badge", () => {
    const html = H.courseCard(base);
    assert.match(html, /href="course-detail\.html\?id=3"/);
    assert.match(html, /\$49/);
    assert.match(html, /line-through;">\$89/);
    assert.match(html, /4\.9/);
    assert.match(html, /\(2,104\)/);
    assert.match(html, /Bestseller/);
  });
  test("escapes user content and hides missing bits", () => {
    const html = H.courseCard({ ...base, title: "<img src=x onerror=alert(1)>", badge: null, original_price: null, rating_count: 0 });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /line-through/);
    assert.match(html, /No ratings yet/);
  });
});

describe("cart", () => {
  test("add is idempotent across kinds, remove and clear work", () => {
    H.cart.clear();
    H.cart.add("course", { id: 1, title: "A", price: 10, instructor_name: "X", icon_bg: "#fff" });
    H.cart.add("course", { id: 1, title: "A", price: 10 });
    H.cart.add("bundle", { id: 1, title: "Bundle", price: 89, courses: [{ icon_bg: "#eee" }, {}] });
    const items = H.cart.items();
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.key), ["course-1", "bundle-1"]);
    assert.equal(items[1].subtitle, "2 courses");
    assert.equal(items[1].href, "bundle.html?id=1");
    assert.equal(H.cart.has("course", 1), true);
    assert.equal(H.cart.has("bundle", 2), false);
    H.cart.remove("course-1");
    assert.deepEqual(H.cart.items().map((i) => i.key), ["bundle-1"]);
    H.cart.clear();
    assert.equal(H.cart.items().length, 0);
  });
  test("entries from the old cart format are ignored", () => {
    localStorage.setItem("coursehub-cart", JSON.stringify([{ id: 1, title: "old" }, { key: "course-2", id: 2, title: "new" }]));
    assert.deepEqual(H.cart.items().map((i) => i.id), [2]);
    H.cart.clear();
  });
  test("wishlist toggles and persists ids as numbers", () => {
    assert.equal(H.wishlist.toggle("3"), true);
    assert.equal(H.wishlist.has(3), true);
    assert.deepEqual(JSON.parse(localStorage.getItem("coursehub-wishlist")), [3]);
    assert.equal(H.wishlist.toggle(3), false);
    assert.equal(H.wishlist.has(3), false);
  });
  test("getParam reads the page query", () => {
    assert.equal(H.getParam("id"), "7");
    assert.equal(H.getParam("missing"), null);
  });
});

describe("validation rules", () => {
  test("email / url / number / minLength", () => {
    assert.equal(H.rules.email("a@b.co"), "");
    assert.notEqual(H.rules.email("nope"), "");
    assert.equal(H.rules.url(""), "");
    assert.equal(H.rules.url("https://x.y"), "");
    assert.notEqual(H.rules.url("x.y"), "");
    assert.equal(H.rules.number(0, 5, "Rating")("4.5"), "");
    assert.notEqual(H.rules.number(0, 5, "Rating")("7"), "");
    assert.notEqual(H.rules.number(0)("abc"), "");
    assert.equal(H.rules.minLength(3)("abcd"), "");
    assert.notEqual(H.rules.minLength(3)("ab"), "");
    assert.notEqual(H.rules.required("Name")(""), "");
  });
});
