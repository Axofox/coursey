/*
  JSON API for the marketplace — router. Route modules live in netlify/lib/routes/.

  Public:      GET categories, courses, courses/:id, bundles[/:id], stats, certificates/:id
               POST applications, auth/signup, auth/login, auth/forgot, auth/reset
  Signed in:   auth/me, auth/logout, auth/password, me/*, enrol, progress, orders/:id, checkout, reviews (POST)
  Instructor:  courses (POST / PUT / DELETE own), courses?mine=1, reviews?mine=1, me/instructor
  Admin:       everything else (?all=1, categories/bundles writes, reviews & applications moderation, users, orders?all=1)

  Admin = a signed-in account with role "admin", or — as a break-glass and for
  bootstrapping the first admin — the ADMIN_TOKEN bearer token.
*/
import { query as dbQuery } from "../lib/db.mjs";
import { json, error, rateLimited, clientIp, safeEqual } from "../lib/http.mjs";
import { sessionUser } from "../lib/auth.mjs";
import { sendMail, templates } from "../lib/mail.mjs";
import * as catalog from "../lib/routes/catalog.mjs";
import { auth } from "../lib/routes/auth.mjs";
import { reviews, applications } from "../lib/routes/reviews.mjs";
import * as learning from "../lib/routes/learning.mjs";
import { checkout, stripeWebhook } from "../lib/routes/checkout.mjs";
import { users } from "../lib/routes/users.mjs";
import { learn, events, experiment, logEvent, flagOn } from "../lib/routes/learn.mjs";

export const config = { path: "/api/*" };

// Re-exported for tests and tooling
export { slugify, resetRateLimits, MAX_BODY_BYTES } from "../lib/http.mjs";
export { curriculumList, parseFields, COURSE_FIELDS, LEVELS, BADGES } from "../lib/validate.mjs";

export function isBreakGlass(req, expected = process.env.ADMIN_TOKEN) {
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return given.length > 0 && safeEqual(given, expected);
}
export const isAuthorized = isBreakGlass; // older name

const PUBLIC_GET = ["categories", "courses", "bundles", "stats", "certificates"];
const PUBLIC_POST = { applications: true, auth: ["signup", "login", "forgot", "reset"] };
const AUTH_LIMITED = ["login", "signup", "forgot", "reset"];

/* Email notifications fan out from here so route modules stay testable. */
function notifier(siteUrl, mailer) {
  return (kind, data) => {
    const send = (to, tpl) => mailer({ to, ...tpl }).catch((e) => console.error("[mail]", e.message));
    switch (kind) {
      case "welcome": return send(data.email, templates.welcome({ name: data.name, siteUrl }));
      case "reset": return send(data.user.email, templates.reset({ name: data.user.name, link: data.link }));
      case "purchase": return send(data.user.email, templates.purchase({ name: data.user.name, items: data.order.items, total: data.order.amount_cents, siteUrl }));
      case "applicationApproved": return send(data.email, templates.applicationApproved({ name: data.name, siteUrl }));
      case "coursePublished": return data.owner_email && send(data.owner_email, templates.coursePublished({ name: data.owner_name, title: data.title, id: data.id, siteUrl }));
      default: return Promise.resolve();
    }
  };
}

export function createHandler({ query = dbQuery, mailer = sendMail, stripe } = {}) {
  return async function handler(req, context) {
    const url = new URL(req.url);
    const [, , resource, id, action, extra] = url.pathname.split("/"); // ["", "api", resource, id?, action?]
    if (extra !== undefined || (action !== undefined && resource !== "learn")) return error("Not found", 404);
    const KNOWN = ["auth", "categories", "courses", "bundles", "stats", "reviews", "applications",
                   "me", "enrol", "progress", "certificates", "orders", "checkout", "users", "stripe", "health",
                   "learn", "events", "experiment"];
    if (!KNOWN.includes(resource)) return error("Not found", 404);
    if (resource === "health") return json({ ok: true });

    const ip = clientIp(req, context);
    const siteUrl = process.env.SITE_URL || url.origin;

    // Stripe posts raw JSON that must be verified byte-for-byte; handle before any body parsing.
    if (resource === "stripe") {
      if (id !== "webhook") return error("Not found", 404);
      try {
        return await stripeWebhook({ query, req, notify: notifier(siteUrl, mailer) }, await req.text());
      } catch (e) {
        console.error(e);
        return error("Server error", 500);
      }
    }

    let user = null;
    try {
      user = await sessionUser(query, req);
    } catch (e) {
      console.error(e);
      return error("Server error", 500);
    }
    const breakGlass = isBreakGlass(req);
    const presentedToken = (req.headers.get("authorization") || "").startsWith("Bearer ");
    if (presentedToken && !breakGlass && rateLimited("auth", ip)) return error("Too many attempts — try again later", 429);
    if (resource === "auth" && req.method === "POST" && AUTH_LIMITED.includes(id) && rateLimited("auth", ip)) {
      return error("Too many attempts — try again later", 429);
    }
    const admin = breakGlass || (user && user.role === "admin");

    const isPublic =
      (req.method === "GET" && PUBLIC_GET.includes(resource)) ||
      (req.method === "POST" && resource === "applications" && id === undefined) ||
      (req.method === "POST" && resource === "auth" && PUBLIC_POST.auth.includes(id)) ||
      (req.method === "GET" && resource === "auth" && id === "me"); // answers null when signed out
    if (!isPublic && !user && !admin) return error("Unauthorized", 401);
    if (req.method === "POST" && ["applications", "reviews"].includes(resource) && id === undefined && !admin && rateLimited("write", ip)) {
      return error("Too many submissions — try again later", 429);
    }

    const ctx = { query, req, url, ip, user, admin, breakGlass, siteUrl, stripe, notify: notifier(siteUrl, mailer) };
    try {
      switch (resource) {
        case "auth": return await auth(ctx, id);
        case "categories": return await catalog.categories(ctx, id);
        case "courses": return await catalog.courses(ctx, id);
        case "bundles": return await catalog.bundles(ctx, id);
        case "stats": return id === undefined && req.method === "GET" ? await catalog.stats(ctx) : error("Not found", 404);
        case "reviews": return await reviews(ctx, id);
        case "applications": return await applications(ctx, id);
        case "me": return await learning.me(ctx, id);
        case "enrol": return id === undefined ? await learning.enrol(ctx) : error("Not found", 404);
        case "progress": return id === undefined ? await learning.progress(ctx) : error("Not found", 404);
        case "certificates": return await learning.certificates(ctx, id);
        case "orders": return await learning.orders(ctx, id);
        case "checkout": return id === undefined ? await checkout(ctx) : error("Not found", 404);
        case "users": return await users(ctx, id);
        case "learn": return await learn(ctx, id, action);
        case "events": return id === undefined ? await events(ctx) : error("Not found", 404);
        case "experiment": return id === undefined ? await experiment(ctx) : error("Not found", 404);
        default: return error("Not found", 404);
      }
    } catch (e) {
      console.error(e);
      return error("Server error", 500);
    }
  };
}

export default createHandler();
