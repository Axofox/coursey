// Shared test helpers: a scripted fake database and a request builder.
import { createHandler, resetRateLimits } from "../netlify/functions/api.mjs";

export const TOKEN = "test-admin-token";

/*
  fakeDb(script) — `script` is a list of [regex, result] pairs. Each query is
  matched against the list in order; the first regex that matches the SQL
  decides the result ({ rows, rowCount }). Every call is recorded in `calls`.
*/
export function fakeDb(script = []) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    for (const [re, result] of script) {
      if (re.test(sql)) {
        const r = typeof result === "function" ? result(params) : result;
        const rows = r.rows ?? (Array.isArray(r) ? r : []);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return { query, calls };
}

export const ADMIN = { id: 1, email: "admin@example.com", name: "Admin", role: "admin", password_hash: "" };
export const LEARNER = { id: 2, email: "ana@example.com", name: "Ana", role: "learner", password_hash: "" };
export const INSTRUCTOR = { id: 3, email: "maya@example.com", name: "Maya Chen", role: "instructor", password_hash: "" };

/* A session lookup that returns `user` when the request carries cookie ch_session=<user.role> */
export const sessionFor = (...users) => [/FROM sessions s JOIN users u/, (params) => users.filter((u) => params[0] === sha256("sess-" + u.role))];
import { createHash } from "node:crypto";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function handlerWith(script = [], opts = {}) {
  resetRateLimits();
  const db = fakeDb([sessionFor(ADMIN, LEARNER, INSTRUCTOR), ...script]);
  const sent = [];
  const mailer = async (msg) => { sent.push(msg); };
  return { handler: createHandler({ query: db.query, mailer, ...opts }), db, sent };
}

export function request(method, path, { token, body, as } = {}) {
  const headers = {};
  if (token) headers.authorization = "Bearer " + token;
  if (as) headers.cookie = "ch_session=sess-" + as; // "admin" | "learner" | "instructor"
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost" + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function call(handler, method, path, opts) {
  const res = await handler(request(method, path, opts));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
