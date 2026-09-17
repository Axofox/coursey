// Shared test helpers: a scripted fake database and a request builder.
import { createHandler } from "../netlify/functions/api.mjs";

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

export function handlerWith(script) {
  const db = fakeDb(script);
  return { handler: createHandler({ query: db.query }), db };
}

export function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = "Bearer " + token;
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
