// Local dev server: serves public/ and an in-memory mock of the /api contract
// (no Postgres on this machine). Only for visual verification.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_CATEGORIES, SEED_COURSES, SEED_BUNDLES } from "../netlify/lib/seed.mjs";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TOKEN = "testtoken";
const cats = SEED_CATEGORIES.map((c, i) => ({ ...c, sort_order: i, created_at: new Date().toISOString() }));
let nextId = 1;
const courses = SEED_COURSES.map((c) => ({
  id: nextId++, language: "English", badge: null, original_price: null, resources: 0, featured: false, published: true,
  learn: [], requirements: [], curriculum: [], ...c, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}));
let nextB = 1, nextR = 1, nextA = 1;
const bundles = SEED_BUNDLES.map((b, i) => ({ id: nextB++, name: b.name, description: b.description, price: b.price, published: true, sort_order: i,
  course_ids: b.courses.map((t) => courses.find((c) => c.title === t)?.id).filter(Boolean), created_at: new Date().toISOString() }));
const reviews = [{ id: nextR++, course_id: 1, name: "Jonas Weber", rating: 5, body: "Clear, structured, and actually project-based — I have a real case study now.", status: "pending", created_at: new Date().toISOString() }];
const applications = [];
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript" };

const catOf = (id) => cats.find((c) => c.id === id);
const ratingOf = (c) => {
  const ok = reviews.filter((r) => r.course_id === c.id && r.status === "approved");
  return ok.length ? { rating: Math.round(ok.reduce((n, r) => n + r.rating, 0) / ok.length * 10) / 10, rating_count: ok.length } : { rating: c.rating, rating_count: c.rating_count };
};
const card = (c) => {
  const k = catOf(c.category_id);
  const lesson_count = c.curriculum.reduce((n, s) => n + s.lessons.length, 0);
  return { id: c.id, category_id: c.category_id, category_name: k.name, icon_bg: k.icon_bg, icon_color: k.icon_color,
    title: c.title, subtitle: c.subtitle, instructor_name: c.instructor_name, level: c.level, price: c.price,
    original_price: c.original_price, badge: c.badge, rating: c.rating, rating_count: c.rating_count, students: c.students,
    featured: c.featured, published: c.published, updated_at: c.updated_at, lesson_count };
};
const full = (c) => { const k = catOf(c.category_id); return { ...c, ...ratingOf(c), category_name: k.name, icon_bg: k.icon_bg, icon_color: k.icon_color,
  reviews: reviews.filter((r) => r.course_id === c.id && r.status === "approved") }; };
const fullBundle = (b, admin) => { const cs = b.course_ids.map((id) => courses.find((c) => c.id === id)).filter((c) => c && (admin || c.published)).map(card); return { ...b, courses: cs, total_value: cs.reduce((n, c) => n + c.price, 0) }; };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/")) {
    const [, , resource, id] = url.pathname.split("/");
    const admin = req.headers.authorization === "Bearer " + TOKEN;
    const isRead = (req.method === "GET" && ["categories", "courses", "stats", "bundles"].includes(resource)) || (req.method === "POST" && ["reviews", "applications"].includes(resource) && !id);
    if (!isRead && !admin) return send(401, { error: "Unauthorized" });
    let body = {};
    if (req.method !== "GET") { body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); })); }
    console.log(req.method, url.pathname + url.search, admin ? "(admin)" : "");
    if (resource === "auth") return send(204);
    if (resource === "stats") {
      const pub = courses.filter((c) => c.published);
      return send(200, { courses: pub.length, instructors: new Set(pub.map((c) => c.instructor_name)).size,
        students: pub.reduce((n, c) => n + c.students, 0), avg_rating: pub.length ? Math.round(pub.reduce((n, c) => n + c.rating, 0) / pub.length * 10) / 10 : 0 });
    }
    if (resource === "categories") {
      const withCount = () => cats.map((k) => ({ ...k, course_count: courses.filter((c) => c.category_id === k.id && c.published).length }));
      if (req.method === "GET") return send(200, id ? withCount().find((c) => c.id === id) : withCount());
      if (req.method === "POST") { const nid = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"); cats.push({ id: nid, name: body.name, description: body.description || "", icon_bg: body.icon_bg, icon_color: body.icon_color }); return send(201, withCount().find((c) => c.id === nid)); }
      if (req.method === "PUT") { Object.assign(catOf(id), body); return send(200, withCount().find((c) => c.id === id)); }
      if (req.method === "DELETE") { if (courses.some((c) => c.category_id === id)) return send(409, { error: "Move or delete the course(s) in this category first" }); cats.splice(cats.indexOf(catOf(id)), 1); return send(204); }
    }
    if (resource === "courses") {
      if (req.method === "GET" && !id) {
        let list = courses.filter((c) => admin && url.searchParams.get("all") === "1" ? true : c.published);
        const cat = url.searchParams.get("category"), q = (url.searchParams.get("q") || "").toLowerCase();
        if (cat) list = list.filter((c) => c.category_id === cat);
        if (url.searchParams.get("featured") === "1") list = list.filter((c) => c.featured);
        if (q) list = list.filter((c) => [c.title, c.subtitle, c.instructor_name, catOf(c.category_id).name].some((s) => s.toLowerCase().includes(q)));
        return send(200, list.map(card));
      }
      if (req.method === "GET") { const c = courses.find((c) => c.id === Number(id) && (admin || c.published)); return c ? send(200, full(c)) : send(404, { error: "Course not found" }); }
      if (req.method === "POST") { const c = { id: nextId++, language: "English", badge: null, original_price: null, featured: false, published: true, learn: [], requirements: [], curriculum: [], rating: 0, rating_count: 0, students: 0, resources: 0, ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; courses.push(c); return send(201, full(c)); }
      if (req.method === "PUT") { const c = courses.find((c) => c.id === Number(id)); if (!c) return send(404, { error: "Course not found" }); Object.assign(c, body, { updated_at: new Date().toISOString() }); return send(200, full(c)); }
      if (req.method === "DELETE") { const i = courses.findIndex((c) => c.id === Number(id)); if (i < 0) return send(404, { error: "Course not found" }); courses.splice(i, 1); return send(204); }
    }
    if (resource === "bundles") {
      const all = admin && url.searchParams.get("all") === "1";
      if (req.method === "GET" && !id) return send(200, bundles.filter((b) => all || b.published).map((b) => fullBundle(b, all)));
      if (req.method === "GET") { const b = bundles.find((b) => b.id === Number(id) && (admin || b.published)); return b ? send(200, fullBundle(b, admin)) : send(404, { error: "Bundle not found" }); }
      if (req.method === "POST") { const b = { id: nextB++, description: "", published: true, course_ids: [], ...body, created_at: new Date().toISOString() }; bundles.push(b); return send(201, fullBundle(b, true)); }
      if (req.method === "PUT") { const b = bundles.find((b) => b.id === Number(id)); if (!b) return send(404, { error: "Bundle not found" }); Object.assign(b, body); return send(200, fullBundle(b, true)); }
      if (req.method === "DELETE") { const i = bundles.findIndex((b) => b.id === Number(id)); if (i < 0) return send(404, { error: "Bundle not found" }); bundles.splice(i, 1); return send(204); }
    }
    if (resource === "reviews") {
      if (req.method === "POST") { if (body.website) return send(204); if (!(body.body || "").trim() || body.body.length < 10) return send(400, { error: "Please write at least a few words" }); const r = { id: nextR++, status: "pending", created_at: new Date().toISOString(), ...body }; reviews.push(r); return send(201, { id: r.id, status: r.status }); }
      if (req.method === "GET") { const st = url.searchParams.get("status"); return send(200, reviews.filter((r) => !st || r.status === st).map((r) => ({ ...r, course_title: courses.find((c) => c.id === r.course_id)?.title || "?" })).reverse()); }
      if (req.method === "PUT") { const r = reviews.find((r) => r.id === Number(id)); if (!r) return send(404, { error: "Review not found" }); r.status = body.status; return send(200, r); }
      if (req.method === "DELETE") { const i = reviews.findIndex((r) => r.id === Number(id)); if (i < 0) return send(404, { error: "Review not found" }); reviews.splice(i, 1); return send(204); }
    }
    if (resource === "applications") {
      if (req.method === "POST") { if (body.website) return send(204); const a = { id: nextA++, status: "new", bio: "", portfolio_url: "", created_at: new Date().toISOString(), ...body }; applications.push(a); return send(201, { id: a.id, status: a.status }); }
      if (req.method === "GET") return send(200, [...applications].reverse());
      if (req.method === "PUT") { const a = applications.find((a) => a.id === Number(id)); if (!a) return send(404, { error: "Application not found" }); a.status = body.status; return send(200, a); }
      if (req.method === "DELETE") { const i = applications.findIndex((a) => a.id === Number(id)); if (i < 0) return send(404, { error: "Application not found" }); applications.splice(i, 1); return send(204); }
    }
    return send(404, { error: "Not found" });
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!fs.existsSync(file)) { file = path.join(PUBLIC, "404.html"); res.writeHead(404, { "Content-Type": "text/html" }); return fs.createReadStream(file).pipe(res); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(8765, () => console.log("mock server on 8765"));
