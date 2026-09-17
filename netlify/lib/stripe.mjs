/*
  Stripe Checkout via the REST API (no SDK — two endpoints and a signature
  check). Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
  Test mode keys (sk_test_…) work exactly the same.
*/
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

// Stripe takes application/x-www-form-urlencoded with bracket notation for nesting.
export function formEncode(obj, prefix = "") {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") parts.push(formEncode(v, key));
    else parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return parts.filter(Boolean).join("&");
}

export async function stripeRequest(path, params, { fetchImpl = fetch } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetchImpl(API + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

/*
  Create a Checkout Session for an order. `items` are already priced by us
  (cents) — Stripe only ever sees what the database says.
*/
export function createCheckoutSession({ order, user, items, successUrl, cancelUrl }, opts) {
  const params = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: user.email,
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), user_id: String(user.id) },
    line_items: {},
  };
  items.forEach((it, i) => {
    params.line_items[i] = {
      quantity: 1,
      price_data: { currency: "usd", unit_amount: it.price_cents, product_data: { name: it.title } },
    };
  });
  return stripeRequest("/checkout/sessions", params, opts);
}

/*
  Verify a webhook signature: header "t=<ts>,v1=<hmac>", signed payload is
  "<ts>.<raw body>" with HMAC-SHA256(secret). Tolerance 5 minutes.
*/
export function verifyWebhook(rawBody, signatureHeader, secret = process.env.STRIPE_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((p) => p.split("=")));
  const ts = Number(parts.t);
  if (!ts || !parts.v1) return null;
  if (Math.abs(now / 1000 - ts) > 300) return null;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(rawBody); } catch (e) { return null; }
}

// Helper for tests: sign a payload the way Stripe does.
export function signPayload(rawBody, secret, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`;
}
