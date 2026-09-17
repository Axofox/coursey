/* Bundle page — one bundle with its included courses */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc, money = H.money;
  var main = document.querySelector("[data-bundle-main]");
  var aside = document.querySelector("[data-bundle-aside]");
  var crumb = document.querySelector("[data-breadcrumb]");
  if (!main) return;

  function render(b) {
    document.title = b.name + " — Coursehub";
    crumb.insertAdjacentHTML("beforeend", '<span>/</span><span style="color:var(--ink-soft);">' + esc(b.name) + "</span>");
    var totals = b.courses.reduce(function (acc, c) {
      var t = H.curriculumTotals(c.curriculum);
      return { lessons: acc.lessons + (c.lesson_count || t.lessons), seconds: acc.seconds + t.seconds };
    }, { lessons: 0, seconds: 0 });
    var save = b.total_value > b.price ? Math.round((1 - b.price / b.total_value) * 100) : 0;

    main.innerHTML =
      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<span class="badge badge-accent">Bundle</span>' + (save ? '<span class="badge badge-accent">Save ' + save + "%</span>" : "") +
        (b.published ? "" : '<span class="badge badge-danger">Draft</span>') +
      "</div>" +
      '<h1 style="font-size:32px;line-height:1.2;margin-bottom:12px;">' + esc(b.name) + "</h1>" +
      (b.description ? '<p style="font-size:16px;color:var(--ink-soft);line-height:1.6;margin-bottom:16px;">' + esc(b.description) + "</p>" : "") +
      '<p style="font-size:13px;color:var(--ink-faint);margin-bottom:32px;">' + b.courses.length + " course" + (b.courses.length === 1 ? "" : "s") +
        (totals.lessons ? " · " + totals.lessons + " lessons" : "") + "</p>" +
      '<h3 style="font-size:18px;margin-bottom:16px;">What’s included</h3>' +
      (b.courses.length
        ? '<div style="display:grid;grid-template-columns:repeat(2, minmax(0,1fr));gap:22px;" class="grid-bundle-courses">' + b.courses.map(H.courseCard).join("") + "</div>"
        : '<p style="font-size:14px;color:var(--ink-faint);">This bundle has no published courses yet.</p>');

    var inCart = H.cart.has("bundle", b.id);
    aside.innerHTML =
      '<div class="card" style="overflow:hidden;box-shadow:var(--shadow-md);">' +
        '<div style="padding:24px;">' +
          '<div style="display:flex;margin-bottom:18px;">' +
            b.courses.slice(0, 3).map(function (c, i) {
              return '<div style="width:52px;height:52px;border-radius:10px;background:' + esc(c.icon_bg) + ";" + (i ? "margin-left:-18px;" : "") + '"></div>';
            }).join("") +
          "</div>" +
          '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">' +
            '<span style="font-size:30px;font-weight:700;font-family:var(--font-display);">' + money(b.price) + "</span>" +
            (save ? '<span style="font-size:15px;color:var(--ink-faint);text-decoration:line-through;">' + money(b.total_value) + "</span>" : "") +
          "</div>" +
          '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:20px;">' + (save ? "Bought separately: " + money(b.total_value) : "One price for every course in the bundle") + "</div>" +
          '<button class="btn btn-secondary btn-block" style="margin-bottom:10px;' + (inCart ? "color:var(--success);border-color:var(--success);" : "") + '" data-cart-toggle>' + (inCart ? "Added to cart" : "Add bundle to cart") + "</button>" +
          '<a href="cart.html" class="btn btn-primary btn-block" data-buy-now>Buy now</a>' +
        "</div></div>";

    var btn = aside.querySelector("[data-cart-toggle]");
    btn.addEventListener("click", function () {
      if (H.cart.has("bundle", b.id)) {
        H.cart.remove("bundle-" + b.id);
        btn.textContent = "Add bundle to cart"; btn.style.color = ""; btn.style.borderColor = "";
      } else {
        H.cart.add("bundle", b);
        btn.textContent = "Added to cart"; btn.style.color = "var(--success)"; btn.style.borderColor = "var(--success)";
      }
    });
    aside.querySelector("[data-buy-now]").addEventListener("click", function () { H.cart.add("bundle", b); });
  }

  function notFound() {
    document.title = "Bundle not found — Coursehub";
    main.innerHTML = '<h1 style="font-size:28px;margin-bottom:12px;">Bundle not found</h1>' +
      '<p style="font-size:15px;color:var(--ink-soft);margin-bottom:24px;">It may have been removed.</p>' +
      '<a href="index.html#bundles" class="btn btn-secondary">See all bundles</a>';
    aside.innerHTML = "";
  }

  var id = H.getParam("id");
  if (!id) return notFound();
  H.api.bundle(id).then(render).catch(function (e) {
    if (e.status === 404) notFound();
    else main.innerHTML = '<p style="color:var(--ink-faint);font-size:14px;">' + esc(e.message) + "</p>";
  });
})();
