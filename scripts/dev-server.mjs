/*
  Local dev / e2e server: serves public/ and routes /api/* to the real API
  handler. Uses DATABASE_URL if set, otherwise starts a throwaway embedded
  Postgres, migrates and seeds it. No Netlify CLI or account needed.

    npm run dev                 → http://localhost:8765

  Test hooks (only with TEST_HOOKS=1, which `npm run dev` and Playwright set):
    POST /__test/reset          drop everything, migrate and seed again
    GET  /__test/mail           every email "sent" so far (as JSON)
    GET  /__test/pay?order=N    simulate Stripe: signs a checkout.session.completed
                                event for that order and posts it to the webhook,
                                then redirects to the success page
  With the hooks on, Stripe is stubbed: checkout returns a URL to /__test/pay.
*/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import pg from "pg";
import { migrate } from "../netlify/lib/migrate.mjs";
import { createHandler, resetRateLimits } from "../netlify/functions/api.mjs";
import { signPayload } from "../netlify/lib/stripe.mjs";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.env.PORT || 8765);
const HOOKS = process.env.TEST_HOOKS === "1";
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".webm": "video/webm", ".svg": "image/svg+xml" };

process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || "testtoken";
process.env.SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
if (HOOKS) {
  process.env.STRIPE_SECRET_KEY = "sk_test_local";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_local";
}

let pool, embedded;
if (process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
} else {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  embedded = new EmbeddedPostgres({
    databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "coursehub-dev-pg-")),
    user: "dev", password: "dev", port: 54390 + Math.floor(Math.random() * 100), persistent: false,
    onLog: () => {}, onError: () => {},
  });
  await embedded.initialise();
  await embedded.start();
  pool = new pg.Pool({ connectionString: `postgresql://dev:dev@localhost:${embedded.getPgClient().port}/postgres`, max: 4 });
}
const query = (t, p) => pool.query(t, p);
await migrate(pool, { log: (m) => console.log("[migrate]", m) });

const mail = [];
const mailer = async (m) => { mail.push(m); console.log(`[mail] to=${m.to} "${m.subject}"`); };
const stripe = HOOKS
  ? { fetchImpl: async (url, init) => {
      const orderId = /client_reference_id=(\d+)/.exec(init.body)?.[1];
      return { ok: true, json: async () => ({ id: "cs_local_" + orderId, url: `${process.env.SITE_URL}/__test/pay?order=${orderId}` }) };
    } }
  : undefined;
const handler = createHandler({ query, mailer, stripe });

async function toWebRequest(req, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });
}
async function sendWebResponse(res, webRes) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  const setCookie = webRes.headers.getSetCookie ? webRes.headers.getSetCookie() : [];
  if (setCookie.length) headers["set-cookie"] = setCookie;
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, process.env.SITE_URL);
  try {
    if (url.pathname.startsWith("/api/")) {
      const webReq = await toWebRequest(req, url.toString());
      return sendWebResponse(res, await handler(webReq, { ip: "127.0.0.1" }));
    }
    if (HOOKS && url.pathname.startsWith("/__test/")) {
      if (url.pathname === "/__test/reset" && req.method === "POST") {
        await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
        await migrate(pool);
        mail.length = 0;
        resetRateLimits();
        res.writeHead(204); return res.end();
      }
      if (url.pathname === "/__test/mail") {
        res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(mail));
      }
      if (url.pathname === "/__test/pay") {
        const orderId = Number(url.searchParams.get("order"));
        const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
        if (!rows[0]) { res.writeHead(404); return res.end("no such order"); }
        const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {
          id: rows[0].stripe_session_id, payment_status: "paid", amount_total: rows[0].amount_cents,
          payment_intent: "pi_local_" + orderId, metadata: { order_id: String(orderId), user_id: String(rows[0].user_id) } } } });
        await handler(new Request(process.env.SITE_URL + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signPayload(payload, "whsec_local") }, body: payload }));
        res.writeHead(302, { location: `/checkout-success.html?order=${orderId}&session_id=${rows[0].stripe_session_id}` }); return res.end();
      }
      res.writeHead(404); return res.end();
    }
    let file = path.join(PUBLIC, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(PUBLIC, "404.html");
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end("dev server error");
  }
}).listen(PORT, () => console.log(`dev server on http://localhost:${PORT}${HOOKS ? " (test hooks on, Stripe stubbed)" : ""}`));

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await pool.end(); if (embedded) await embedded.stop(); process.exit(0); });
