/* Cart page — renders the browser cart into the design's row markup.
   Runs synchronously before script.js so its cart maths picks the rows up.
   Checkout itself isn't connected to a payment provider yet. */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var list = document.querySelector("[data-cart-list]");
  if (!list) return;

  var X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  var items = H.cart.items();
  list.innerHTML = items.map(function (it, i) {
    return '<div data-cart-row data-cart-key="' + esc(it.key) + '" data-cart-price="' + Number(it.price) + '" style="display:flex;align-items:center;gap:16px;padding:18px 20px;' + (i < items.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '">' +
      '<div style="width:88px;height:56px;border-radius:8px;flex-shrink:0;background:' + esc(it.icon_bg || "#EDEBFB") + ';"></div>' +
      '<div style="flex-grow:1;min-width:0;">' +
        '<a href="' + esc(it.href) + '" style="font-size:14px;font-weight:600;margin-bottom:3px;display:block;">' + esc(it.title) + (it.kind === "bundle" ? ' <span class="badge badge-accent">Bundle</span>' : "") + "</a>" +
        '<div style="font-size:12px;color:var(--ink-soft);">' + esc(it.subtitle) + "</div>" +
      "</div>" +
      '<div style="font-size:15px;font-weight:700;">' + H.money(it.price) + "</div>" +
      '<button data-remove-row aria-label="Remove" style="color:var(--ink-faint);padding:6px;">' + X + "</button>" +
    "</div>";
  }).join("");

  // script.js hides the row and recalculates; we also forget it in storage
  list.querySelectorAll("[data-remove-row]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      H.cart.remove(btn.closest("[data-cart-row]").getAttribute("data-cart-key"));
    });
  });

  document.addEventListener("DOMContentLoaded", async function () {
    var pay = document.querySelector("[data-pay-total]");
    if (!pay) return;
    var signin = document.querySelector("[data-checkout-signin]");
    var errBox = document.querySelector("[data-checkout-error]");
    if (H.getParam("cancelled")) H.toast("Checkout cancelled — your cart is still here.");
    var user = await H.session.get();
    if (!user) signin.classList.remove("hide");

    pay.addEventListener("click", async function () {
      var items = H.cart.items();
      if (!items.length) return H.toast("Your cart is empty.");
      if (!user) return H.session.requireLogin("cart.html");
      pay.disabled = true;
      pay.textContent = "Taking you to checkout…";
      errBox.classList.add("hide");
      try {
        var r = await H.api.checkout(items.map(function (i) { return { kind: i.kind, id: i.id }; }));
        try { sessionStorage.setItem("coursehub-pending-order", String(r.order_id)); } catch (e) {}
        location.href = r.url;
      } catch (e) {
        errBox.textContent = e.status === 503 ? "Payments aren’t switched on for this site yet." : e.message;
        errBox.classList.remove("hide");
        pay.disabled = false;
        pay.textContent = "Checkout";
      }
    });
  });
})();
