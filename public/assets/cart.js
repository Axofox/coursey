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
    return '<div data-cart-row data-cart-id="' + it.id + '" data-cart-price="' + Number(it.price) + '" style="display:flex;align-items:center;gap:16px;padding:18px 20px;' + (i < items.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '">' +
      '<div style="width:88px;height:56px;border-radius:8px;flex-shrink:0;background:' + esc(it.icon_bg || "#EDEBFB") + ';"></div>' +
      '<div style="flex-grow:1;min-width:0;">' +
        '<a href="course-detail.html?id=' + it.id + '" style="font-size:14px;font-weight:600;margin-bottom:3px;display:block;">' + esc(it.title) + "</a>" +
        '<div style="font-size:12px;color:var(--ink-soft);">' + esc(it.instructor_name) + "</div>" +
      "</div>" +
      '<div style="font-size:15px;font-weight:700;">' + H.money(it.price) + "</div>" +
      '<button data-remove-row aria-label="Remove" style="color:var(--ink-faint);padding:6px;">' + X + "</button>" +
    "</div>";
  }).join("");

  // script.js hides the row and recalculates; we also forget it in storage
  list.querySelectorAll("[data-remove-row]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      H.cart.remove(Number(btn.closest("[data-cart-row]").getAttribute("data-cart-id")));
    });
  });

  document.addEventListener("DOMContentLoaded", function () {
    var pay = document.querySelector("[data-pay-total]");
    if (!pay) return;
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "Checkout isn’t connected to a payment provider yet.";
    document.body.appendChild(toast);
    pay.addEventListener("click", function () {
      toast.classList.add("show");
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { toast.classList.remove("show"); }, 2600);
    });
  });
})();
