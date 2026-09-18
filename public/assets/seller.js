/* Instructor Studio: own courses, sales, students, reviews, profile */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var $ = function (sel) { return document.querySelector(sel); };
  if (!$('[data-tab-group="seller"]')) return;

  var me = null;
  var fmtDate = function (iso) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
  var statusBadge = { published: '<span class="badge badge-success">Published</span>', pending: '<span class="badge badge-amber">Pending review</span>', draft: '<span class="badge badge-neutral">Draft</span>' };

  function set(k, v) { document.querySelectorAll('[data-st="' + k + '"]').forEach(function (el) { el.textContent = v; }); }

  function render(studio, reviews) {
    var courses = studio.courses;
    var revenueBy = {};
    studio.sales.forEach(function (s) { s.courses.forEach(function (cid) { revenueBy[cid] = (revenueBy[cid] || 0) + Math.round(s.cents / s.courses.length); }); });
    var rated = courses.filter(function (c) { return c.rating_count > 0; });
    set("students", H.num(studio.students.length));
    set("gross", H.money(studio.gross_cents / 100)); set("gross2", H.money(studio.gross_cents / 100));
    set("payout", H.money(studio.payout_cents / 100));
    set("rating", rated.length ? (rated.reduce(function (n, c) { return n + c.rating; }, 0) / rated.length).toFixed(1) : "—");
    set("courses", courses.length);

    $("[data-my-courses]").innerHTML = courses.map(function (c) {
      return '<div class="trow" style="grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 0.8fr;min-width:680px;">' +
        '<div class="tcell" style="gap:12px;"><div class="thumb" style="background:' + esc(c.icon_bg) + ';"></div><a href="course-detail.html?id=' + c.id + '" style="font-weight:500;">' + esc(c.title) + "</a></div>" +
        '<div class="tcell">' + statusBadge[c.status] + "</div>" +
        '<div class="tcell">' + c.enrolled_count + "</div>" +
        '<div class="tcell">' + H.money((revenueBy[c.id] || 0) / 100) + "</div>" +
        '<div class="tcell">' + (c.rating_count ? Number(c.rating).toFixed(1) : "—") + "</div>" +
        '<div class="tcell"><a href="course-upload.html?id=' + c.id + '" style="color:var(--accent-strong);font-weight:600;font-size:13px;">Edit</a></div></div>';
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">You haven’t created a course yet. <a href="course-upload.html" style="color:var(--accent-strong);font-weight:600;margin-left:6px;">Create your first</a></div>';

    $("[data-sales]").innerHTML = studio.sales.map(function (s) {
      return '<div class="trow" style="grid-template-columns:110px 1fr 110px;min-width:420px;">' +
        '<div class="tcell" style="color:var(--ink-soft);">' + fmtDate(s.paid_at) + "</div>" +
        '<div class="tcell">' + esc(s.title) + ' <span style="color:var(--ink-faint);font-size:12px;margin-left:6px;">order #' + s.order_id + "</span></div>" +
        '<div class="tcell" style="font-weight:600;">+' + H.money(s.cents / 100) + "</div></div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">No sales yet.</div>';

    $("[data-students]").innerHTML = studio.students.map(function (st) {
      var c = courses.find(function (x) { return x.id === st.course_id; });
      return '<div class="trow" style="grid-template-columns:1.4fr 1.6fr 1.6fr 1fr;min-width:640px;">' +
        '<div class="tcell" style="font-weight:500;">' + esc(st.name) + "</div>" +
        '<div class="tcell" style="color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;">' + esc(st.email) + "</div>" +
        '<div class="tcell" style="color:var(--ink-soft);">' + esc(c ? c.title : "#" + st.course_id) + "</div>" +
        '<div class="tcell" style="color:var(--ink-faint);">' + fmtDate(st.created_at) + "</div></div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">No students yet.</div>';

    $("[data-my-reviews]").innerHTML = reviews.map(function (r) {
      return '<div class="card" style="padding:18px 20px;">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:10px;"><strong style="font-size:14px;">' + esc(r.name) + "</strong>" + H.stars(r.rating) +
          (r.verified ? '<span class="badge badge-success">Enrolled</span>' : "") + "</div>" +
          '<span style="font-size:12px;color:var(--ink-faint);">' + esc(r.course_title) + " · " + fmtDate(r.created_at) + "</span></div>" +
        '<p style="font-size:14px;color:var(--ink-soft);line-height:1.6;">' + esc(r.body) + "</p></div>";
    }).join("") || '<div class="card" style="padding:28px;color:var(--ink-faint);font-size:14px;">No approved reviews on your courses yet.</div>';
  }

  function initProfile() {
    var f = $("[data-profile-form]");
    f.name.value = me.name; f.headline.value = me.headline || ""; f.bio.value = me.bio || "";
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!H.validate(f, { name: H.rules.required("Display name") })) return;
      try {
        me = await H.api.updateMe({ name: f.name.value.trim(), headline: f.headline.value.trim(), bio: f.bio.value.trim() });
        H.session.set(me); fillMe(); H.toast("Profile saved.");
      } catch (err) { var b = $("[data-profile-error]"); b.textContent = err.message; b.classList.remove("hide"); }
    });
  }
  function fillMe() {
    document.querySelectorAll("[data-me-name]").forEach(function (el) { el.textContent = me.name; });
    document.querySelectorAll("[data-me-initials]").forEach(function (el) { el.textContent = H.initials(me.name); });
  }

  (async function () {
    me = await H.session.get();
    if (!me) return H.session.requireLogin("seller-dashboard.html");
    if (me.role === "learner") { location.href = "teach.html"; return; }
    fillMe();
    var results = await Promise.all([H.api.myInstructor(), H.api.myReviews().catch(function () { return []; })]);
    // /api/auth/me is the public shape; headline/bio come with it? fetch the full profile fields lazily
    render(results[0], results[1]);
    initProfile();
    var wanted = H.getParam("tab");
    var target = wanted && document.querySelector('[data-tab-group="seller"][data-tab="' + wanted + '"]');
    if (target) target.click();
  })();
})();
