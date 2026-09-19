/*
  POST /api/checkout         { items: [{ kind: "course"|"bundle", id }] }  (signed in)
        → creates a pending order priced from the database and a Stripe
          Checkout Session; responds { url } to redirect to.
  POST /api/stripe/webhook   Stripe → us. On checkout.session.completed the
          order is marked paid and enrolments are created. Idempotent.

  Nothing from the browser is trusted for money: not prices, not discounts,
  not titles. The browser only says which ids it wants.
*/
import { json, error, readBody, bodyError } from "../http.mjs";
import { listCourses, listBundles } from "./catalog.mjs";
import { createCheckoutSession, verifyWebhook } from "../stripe.mjs";
import { logEvent } from "./learn.mjs";

const cents = (n) => Math.round(Number(n) * 100);

export async function priceItems(query, userId, items) {
  const wanted = (Array.isArray(items) ? items : []).slice(0, 20)
    .map((i) => ({ kind: i.kind === "bundle" ? "bundle" : "course", id: Number(i.id) }))
    .filter((i) => Number.isInteger(i.id) && i.id > 0);
  if (!wanted.length) return { error: "Your cart is empty" };

  const courseIds = wanted.filter((i) => i.kind === "course").map((i) => i.id);
  const courses = courseIds.length ? await listCourses(query, { ids: courseIds }) : [];
  const bundleIds = wanted.filter((i) => i.kind === "bundle").map((i) => i.id);
  const bundles = [];
  for (const id of bundleIds) bundles.push(...(await listBundles(query, { id })));

  const { rows: owned } = await query("SELECT course_id FROM enrolments WHERE user_id = $1", [userId]);
  const have = new Set(owned.map((r) => r.course_id));

  const priced = [];
  for (const w of wanted) {
    if (w.kind === "course") {
      const c = courses.find((x) => x.id === w.id);
      if (!c) return { error: "A course in your cart is no longer available" };
      if (have.has(c.id)) continue; // already enrolled — skip silently
      priced.push({ kind: "course", id: c.id, title: c.title, price_cents: cents(c.price), course_ids: [c.id] });
    } else {
      const b = bundles.find((x) => x.id === w.id);
      if (!b || !b.courses.length) return { error: "A bundle in your cart is no longer available" };
      priced.push({ kind: "bundle", id: b.id, title: b.name, price_cents: cents(b.price), course_ids: b.courses.map((c) => c.id) });
    }
  }
  if (!priced.length) return { error: "You already own everything in your cart" };
  return { items: priced, total: priced.reduce((n, i) => n + i.price_cents, 0) };
}

export async function fulfilOrder(query, order, notify) {
  if (order.status === "paid") return; // webhook retries are fine
  await query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1", [order.id]);
  const courseIds = [...new Set(order.items.flatMap((i) => i.course_ids.map(Number)))];
  for (const cid of courseIds) {
    const res = await query(
      "INSERT INTO enrolments (user_id, course_id, order_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, course_id) DO NOTHING",
      [order.user_id, cid, order.id]
    );
    if (res.rowCount) {
      const { rows } = await query("SELECT (features->>'learner_setup')::boolean IS TRUE AS flag FROM courses WHERE id = $1", [cid]);
      await logEvent(query, "enrolled", { userId: order.user_id, courseId: cid, props: { via: "purchase", order_id: order.id, flag: !!(rows[0] && rows[0].flag) } });
    }
  }
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [order.user_id]);
  if (rows[0] && notify) notify("purchase", { user: rows[0], order });
}

export async function checkout(ctx) {
  const { query, user, req } = ctx;
  if (req.method !== "POST") return error("Method not allowed", 405);
  if (!user) return error("Sign in to check out", 401);
  const body = await readBody(req);
  if (!body || body === "too-large") return bodyError(body);
  const priced = await priceItems(query, user.id, body.items);
  if (priced.error) return error(priced.error, 400);

  const { rows } = await query(
    "INSERT INTO orders (user_id, amount_cents, items) VALUES ($1, $2, $3) RETURNING *",
    [user.id, priced.total, JSON.stringify(priced.items)]
  );
  const order = rows[0];

  if (priced.total === 0) { // everything free — no Stripe needed
    await fulfilOrder(query, order, ctx.notify);
    return json({ url: `${ctx.siteUrl}/checkout-success.html?order=${order.id}`, order_id: order.id });
  }
  if (!process.env.STRIPE_SECRET_KEY) return error("Payments aren't configured on this site yet", 503);

  const session = await createCheckoutSession({
    order, user, items: priced.items,
    successUrl: `${ctx.siteUrl}/checkout-success.html?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${ctx.siteUrl}/cart.html?cancelled=1`,
  }, ctx.stripe);
  await query("UPDATE orders SET stripe_session_id = $2 WHERE id = $1", [order.id, session.id]);
  return json({ url: session.url, order_id: order.id });
}

export async function stripeWebhook(ctx, rawBody) {
  const { query, req } = ctx;
  if (req.method !== "POST") return error("Method not allowed", 405);
  let event;
  try {
    event = verifyWebhook(rawBody, req.headers.get("stripe-signature"));
  } catch (e) {
    return error("Webhooks aren't configured", 503);
  }
  if (!event) return error("Bad signature", 400);

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.payment_status && session.payment_status !== "paid") return json({ received: true, ignored: "unpaid" });
    const orderId = Number(session.metadata && session.metadata.order_id) || Number(session.client_reference_id);
    const { rows } = await query("SELECT * FROM orders WHERE id = $1 AND (stripe_session_id = $2 OR stripe_session_id IS NULL)", [orderId, session.id]);
    if (!rows[0]) return json({ received: true, ignored: "unknown order" });
    if (session.amount_total !== undefined && Number(session.amount_total) !== rows[0].amount_cents) {
      return json({ received: true, ignored: "amount mismatch" }); // never fulfil an order for the wrong amount
    }
    await query("UPDATE orders SET stripe_session_id = $2, stripe_payment_intent = $3 WHERE id = $1",
      [orderId, session.id, session.payment_intent || null]);
    await fulfilOrder(query, rows[0], ctx.notify);
  }
  return json({ received: true });
}
