/* Shared HTTP helpers for the API: responses, body parsing, rate limiting, input cleaning. */
import { timingSafeEqual } from "node:crypto";

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
export const error = (message, status) => json({ error: message }, status);
export const noContent = (headers = {}) => new Response(null, { status: 204, headers });

export const clean = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const isColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
export const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v);
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

export const MAX_BODY_BYTES = 64 * 1024; // a full course record is a few KB

// Returns the parsed object, null for invalid JSON, or the string "too-large".
export async function readBody(req) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return "too-large";
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return "too-large";
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch (e) {
    return null;
  }
}
export const bodyError = (body) => (body === "too-large" ? error("Request body too large", 413) : error("Invalid JSON", 400));

/*
  Rate limiting — a sliding window per client IP, kept in memory. Netlify
  Functions may run several instances, so this is a per-instance cap, not a
  global guarantee; it blunts casual abuse of the public write endpoints and
  credential guessing without any extra infrastructure.
*/
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { write: 10, auth: 20 }; // per window
const buckets = new Map();
export function rateLimited(kind, ip, now = Date.now()) {
  const key = kind + ":" + ip;
  const hits = (buckets.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (buckets.size > 5000) buckets.clear(); // keep memory bounded on a hot instance
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > LIMITS[kind];
}
export function resetRateLimits() { buckets.clear(); }
export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
}

export const idOr404 = (id) => {
  if (id === undefined) return undefined;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null; // null → caller returns 404
};
