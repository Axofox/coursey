/* Field validation for writable resources. */
import { clean, isHttpUrl } from "./http.mjs";

export const LEVELS = ["Beginner", "Intermediate", "Advanced"];
export const BADGES = ["Bestseller", "New"];
export const STATUSES = ["draft", "pending", "published"];

function money(v) {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
function count(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
function stringList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((s) => clean(s)).filter(Boolean);
  return out.length <= 50 ? out : undefined;
}
function idList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map(Number))];
  return out.every((n) => Number.isInteger(n) && n > 0) ? out : undefined;
}
export function curriculumList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const s of v) {
    if (!s || typeof s !== "object") return undefined;
    const title = clean(s.title);
    if (!title) continue;
    const lessons = [];
    for (const l of Array.isArray(s.lessons) ? s.lessons : []) {
      if (!l || typeof l !== "object") return undefined;
      const lt = clean(l.title);
      if (!lt) continue;
      const duration = clean(l.duration);
      if (duration && !/^\d{1,3}(:[0-5]\d)?$/.test(duration)) return undefined;
      const video_url = clean(l.video_url);
      if (video_url && !isHttpUrl(video_url)) return undefined;
      lessons.push({ title: lt, duration, video_url, preview: l.preview === true });
    }
    out.push({ title, lessons });
  }
  return out;
}

// One entry per writable course column: how to normalise the raw value and
// the message to return when it's invalid.
export const COURSE_FIELDS = {
  category_id:      { parse: (v) => clean(v), required: true, msg: "category_id is required" },
  title:            { parse: (v) => clean(v, 200), required: true, msg: "title is required" },
  subtitle:         { parse: (v) => clean(v, 500) },
  description:      { parse: (v) => clean(v, 10000) },
  instructor_name:  { parse: (v) => clean(v, 200) },
  instructor_title: { parse: (v) => clean(v, 200) },
  instructor_bio:   { parse: (v) => clean(v) },
  level:            { parse: (v) => (LEVELS.includes(v) ? v : undefined), msg: `level must be one of: ${LEVELS.join(", ")}` },
  language:         { parse: (v) => clean(v, 50) || "English" },
  price:            { parse: (v) => money(v) ?? undefined, msg: "price must be a number ≥ 0" },
  original_price:   { parse: money, msg: "original_price must be a number ≥ 0 or empty" },
  badge:            { parse: (v) => (v === null || v === "" ? null : BADGES.includes(v) ? v : undefined), msg: `badge must be one of: ${BADGES.join(", ")} or empty` },
  rating:           { parse: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : undefined; }, msg: "rating must be 0–5" },
  rating_count:     { parse: count, msg: "rating_count must be a whole number ≥ 0" },
  students:         { parse: count, msg: "students must be a whole number ≥ 0" },
  resources:        { parse: count, msg: "resources must be a whole number ≥ 0" },
  learn:            { parse: stringList, msg: "learn must be a list of strings", json: true },
  requirements:     { parse: stringList, msg: "requirements must be a list of strings", json: true },
  curriculum:       { parse: curriculumList, msg: "curriculum must be a list of sections with lessons (duration as m:ss, video_url as http(s) link)", json: true },
  featured:         { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "featured must be true/false" },
  status:           { parse: (v) => (STATUSES.includes(v) ? v : undefined), msg: `status must be one of: ${STATUSES.join(", ")}` },
};

// `published: true/false` is accepted as shorthand for status published/draft.
export function normaliseStatus(body) {
  if (body && body.published !== undefined && body.status === undefined) {
    if (typeof body.published !== "boolean") return { error: "published must be true/false" };
    body.status = body.published ? "published" : "draft";
    delete body.published;
  }
  return {};
}

export const BUNDLE_FIELDS = {
  name:        { parse: (v) => clean(v, 200), required: true, msg: "name is required" },
  description: { parse: (v) => clean(v, 1000) },
  price:       { parse: (v) => money(v) ?? undefined, msg: "price must be a number ≥ 0" },
  course_ids:  { parse: idList, msg: "course_ids must be a list of course ids", json: true },
  published:   { parse: (v) => (typeof v === "boolean" ? v : undefined), msg: "published must be true/false" },
};

// Returns { fields } with only the keys present in body, or { error }.
export function parseFields(spec, body, { creating }) {
  const fields = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (body[key] === undefined) {
      if (creating && rule.required) return { error: rule.msg };
      continue;
    }
    const value = rule.parse(body[key]);
    if (value === undefined || (rule.required && value === "")) return { error: rule.msg || `${key} is invalid` };
    fields[key] = rule.json ? JSON.stringify(value) : value;
  }
  return { fields };
}

