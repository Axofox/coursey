/* Order confirmation: polls the order until the Stripe webhook has marked it paid. */
(function () {
  "use strict";
  var H = window.Coursehub;
  var box = document.querySelector("[data-order-state]");
  if (!box) return;
  var orderId = Number(H.getParam("order"));
  if (!orderId) { location.replace("cart.html"); return; }

  function render(order) {
    if (order.status !== "paid") return false;
    // The purchased items leave the cart
    H.cart.items().forEach(function (i) {
      if (order.items.some(function (it) { return it.kind === i.kind && it.id === i.id; })) H.cart.remove(i.key);
    });
    box.innerHTML = '<div class="badge badge-success" style="margin-bottom:16px;">Payment received</div>' +
      '<h1 style="font-size:28px;margin-bottom:10px;">You\u2019re enrolled 🎉</h1>' +
      '<p style="font-size:15px;color:var(--ink-soft);margin-bottom:24px;">Order #' + order.id + ' \u00B7 ' + H.money(order.amount_cents / 100) + '. A receipt is on its way to your inbox.</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;max-width:420px;margin:0 auto 28px;text-align:left;">' +
        order.items.map(function (it) {
          return '<div style="display:flex;justify-content:space-between;font-size:14px;padding:10px 0;border-bottom:1px solid var(--border);"><span>' + H.esc(it.title) + (it.kind === "bundle" ? ' <span class="badge badge-accent">Bundle</span>' : "") + "</span><span>" + H.money(it.price_cents / 100) + "</span></div>";
        }).join("") +
      "</div>" +
      '<a href="dashboard.html" class="btn btn-primary">Start learning</a>';
    return true;
  }

  var tries = 0;
  (async function poll() {
    try {
      var order = await H.api.order(orderId);
      if (render(order)) return;
    } catch (e) {
      if (e.status === 401) return H.session.requireLogin("checkout-success.html?order=" + orderId);
      if (e.status === 404) { box.innerHTML = '<h1 style="font-size:24px;">Order not found</h1><p style="margin-top:10px;"><a href="dashboard.html" class="navlink">Go to My learning</a></p>'; return; }
    }
    if (++tries < 20) setTimeout(poll, 1500);
    else box.innerHTML = '<div class="badge badge-amber" style="margin-bottom:16px;">Still processing</div>' +
      '<h1 style="font-size:24px;margin-bottom:10px;">Payment is taking longer than usual</h1>' +
      '<p style="font-size:15px;color:var(--ink-soft);margin-bottom:20px;">If you were charged, your courses will appear in My learning within a few minutes. Nothing else to do.</p>' +
      '<a href="dashboard.html" class="btn btn-secondary">Go to My learning</a>';
  })();
})();
