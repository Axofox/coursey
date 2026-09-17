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

  document.addEventListener("DOMContentLoaded", function () {
    var pay = document.querySelector("[data-pay-total]");
    var form = document.querySelector("[data-checkout-form]");
    if (!pay) return;
    pay.addEventListener("click", function () {
      if (!H.cart.items().length) return H.toast("Your cart is empty.");
      var cardTab = document.querySelector('[data-tab-group="payment"][data-tab="card"]');
      if (form && cardTab && cardTab.classList.contains("active")) {
        var ok = H.validate(form, {
          "cc-name": H.rules.required("Name on card"),
          "cc-number": function (v) { return /^\d{13,19}$/.test(v.replace(/\s+/g, "")) ? "" : "Enter a 13\u201319 digit card number."; },
          "cc-expiry": function (v) {
            var m = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/.exec(v);
            if (!m) return "Use MM / YY.";
            return new Date(2000 + Number(m[2]), Number(m[1]), 1) > new Date() ? "" : "This card has expired.";
          },
          "cc-cvc": function (v) { return /^\d{3,4}$/.test(v) ? "" : "3 or 4 digits."; },
          "cc-postal": H.rules.required("Postal code"),
        });
        if (!ok) return;
      }
      H.toast("Checkout isn\u2019t connected to a payment provider yet \u2014 nothing was charged.");
    });

    // Promo: only PROMO10 is valid in the prototype (script.js applies the 10%)
    var promo = document.getElementById("promo");
    var promoBtn = document.querySelector("[data-promo-apply]");
    if (promo && promoBtn) {
      promoBtn.addEventListener("click", function (e) {
        if (promoBtn.textContent.indexOf("applied") !== -1) return; // removing the code is always fine
        if (promo.value.trim().toUpperCase() !== "PROMO10") {
          e.stopImmediatePropagation();
          H.toast("That code isn\u2019t valid. Try PROMO10.");
        }
      }, true);
    }
  });
})();
