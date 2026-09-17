/* Learner dashboard — only the Wishlist tab is backed by real data (the browser
   wishlist); everything else is sample content until accounts exist. */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var panel = document.querySelector('[data-tab-panel="wishlist"]');
  var empty = document.querySelector("[data-wishlist-empty]");
  if (!panel || !empty) return;

  var X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function row(c) {
    var inCart = H.cart.has("course", c.id);
    return '<div class="card" data-wishlist-row="' + c.id + '" style="padding:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
      '<a href="course-detail.html?id=' + c.id + '" style="width:96px;height:60px;border-radius:8px;flex-shrink:0;background:' + esc(c.icon_bg) + ';"></a>' +
      '<div style="flex-grow:1;min-width:160px;">' +
        '<a href="course-detail.html?id=' + c.id + '" style="font-size:14px;font-weight:600;margin-bottom:3px;display:block;">' + esc(c.title) + "</a>" +
        '<div style="font-size:12px;color:var(--ink-soft);">' + esc(c.instructor_name) + "</div></div>" +
      '<div style="font-size:15px;font-weight:700;">' + H.money(c.price) + "</div>" +
      '<button class="btn btn-primary" style="height:36px;" data-move="' + c.id + '"' + (inCart ? " disabled" : "") + ">" + (inCart ? "In cart" : "Move to cart") + "</button>" +
      '<button data-remove="' + c.id + '" aria-label="Remove" style="color:var(--ink-faint);padding:6px;">' + X + "</button></div>";
  }

  async function render() {
    var ids = H.wishlist.ids();
    panel.querySelectorAll("[data-wishlist-row]").forEach(function (r) { r.remove(); });
    if (!ids.length) { empty.classList.remove("hide"); return; }
    empty.classList.add("hide");
    var courses;
    try {
      courses = (await H.api.courses({})).filter(function (c) { return ids.indexOf(c.id) !== -1; });
    } catch (e) {
      empty.textContent = "Couldn’t load your wishlist right now.";
      empty.classList.remove("hide");
      return;
    }
    if (!courses.length) { empty.classList.remove("hide"); return; }
    empty.insertAdjacentHTML("beforebegin", courses.map(row).join(""));
    panel.querySelectorAll("[data-move]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = courses.find(function (x) { return x.id === Number(b.dataset.move); });
        H.cart.add("course", c);
        H.wishlist.toggle(c.id);
        H.toast("“" + c.title + "” moved to your cart.");
        render();
      });
    });
    panel.querySelectorAll("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () { H.wishlist.toggle(Number(b.dataset.remove)); render(); });
    });
  }
  render();
})();
