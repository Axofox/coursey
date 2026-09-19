/* Learner dashboard: enrolments + progress, certificates, wishlist, orders, settings */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var $ = function (sel) { return document.querySelector(sel); };
  if (!$('[data-tab-group="dashboard"]')) return;

  var me = null, courses = [], filter = "All";
  var fmtDate = function (iso) { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
  var statusOf = function (c) { return c.progress_pct >= 100 ? "Completed" : c.completed_lessons > 0 ? "In progress" : "Not started"; };
  var badgeFor = { "Completed": "badge-success", "In progress": "badge-accent", "Not started": "badge-neutral" };
  var resumeHref = function (c) { return "lesson.html?course=" + c.id; }; // plan mode redirects to setup when needed

  /* ---------- Overview ---------- */
  function renderOverview() {
    var set = function (k, v) { var el = $('[data-ov="' + k + '"]'); if (el) el.textContent = v; };
    set("enrolled", courses.length);
    set("lessons", courses.reduce(function (n, c) { return n + c.completed_lessons; }, 0));
    set("certificates", courses.filter(function (c) { return c.certificate_id; }).length);
    set("wishlist", H.wishlist.ids().length);
    var active = courses.filter(function (c) { return c.progress_pct < 100; }).slice(0, 3);
    $("[data-continue]").innerHTML = active.length ? active.map(function (c) {
      return '<div class="card" style="overflow:hidden;">' +
        '<a href="' + resumeHref(c) + '" style="aspect-ratio:16/9;display:block;background:' + esc(c.icon_bg) + ';"></a>' +
        '<div style="padding:16px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;line-height:1.3;">' + esc(c.title) + "</div>" +
          '<div class="progress-track" style="margin-bottom:6px;"><div class="progress-fill" style="width:' + c.progress_pct + '%;"></div></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">' +
            '<span style="font-size:12px;color:var(--ink-faint);">' + c.progress_pct + "% complete</span>" +
            '<a href="' + resumeHref(c) + '" class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px;">' + (c.completed_lessons ? "Resume" : "Start") + "</a>" +
          "</div></div></div>";
    }).join("") : '<div class="card" style="padding:28px;grid-column:1/-1;color:var(--ink-faint);font-size:14px;">No courses in progress. <a href="index.html#catalog" style="color:var(--accent-strong);font-weight:600;">Find your next one</a></div>';
  }

  /* ---------- My courses ---------- */
  function renderCourses() {
    var list = courses.filter(function (c) { return filter === "All" || statusOf(c) === filter; });
    $("[data-course-list]").innerHTML = list.map(function (c) {
      var st = statusOf(c);
      return '<div class="card" style="padding:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
        '<a href="course-detail.html?id=' + c.id + '" style="width:96px;height:60px;border-radius:8px;flex-shrink:0;background:' + esc(c.icon_bg) + ';"></a>' +
        '<div style="flex-grow:1;min-width:180px;">' +
          '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + esc(c.title) + "</div>" +
          '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px;">' + esc(c.instructor_name) + " · " + c.completed_lessons + "/" + c.lesson_count + " lessons</div>" +
          '<div class="progress-track" style="max-width:220px;"><div class="progress-fill" style="width:' + c.progress_pct + '%;"></div></div>' +
        "</div>" +
        '<span class="badge ' + badgeFor[st] + '">' + st + "</span>" +
        (st === "Completed"
          ? '<a href="certificate.html?id=' + esc(c.certificate_id) + '" class="btn btn-secondary" style="height:36px;">Certificate</a>'
          : '<a href="' + resumeHref(c) + '" class="btn btn-secondary" style="height:36px;">' + (st === "In progress" ? "Continue" : "Start") + "</a>") +
      "</div>";
    }).join("");
    $("[data-course-empty]").classList.toggle("hide", list.length > 0);
  }
  document.querySelectorAll("[data-course-filter]").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.courseFilter;
      document.querySelectorAll("[data-course-filter]").forEach(function (x) { x.classList.toggle("active", x === b); });
      renderCourses();
    });
  });

  /* ---------- Certificates ---------- */
  async function renderCertificates() {
    var certs = await H.api.myCertificates().catch(function () { return []; });
    $("[data-certificates]").innerHTML = certs.map(function (c) {
      return '<div class="card" style="padding:22px;">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:var(--amber-tint);color:var(--amber);display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:18px;">🎓</div>' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + esc(c.course_title) + "</div>" +
        '<div style="font-size:12px;color:var(--ink-faint);margin-bottom:14px;">Completed ' + fmtDate(c.issued_at) + "</div>" +
        '<a href="certificate.html?id=' + esc(c.id) + '" class="btn btn-secondary btn-block" style="height:36px;">View &amp; download</a></div>';
    }).join("");
    $("[data-certificates-empty]").classList.toggle("hide", certs.length > 0);
  }

  /* ---------- Wishlist ---------- */
  var X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  async function renderWishlist() {
    var panel = $('[data-tab-panel="wishlist"]'), empty = $("[data-wishlist-empty]");
    var ids = H.wishlist.ids();
    panel.querySelectorAll("[data-wishlist-row]").forEach(function (r) { r.remove(); });
    if (!ids.length) { empty.classList.remove("hide"); return; }
    empty.classList.add("hide");
    var list = (await H.api.courses({}).catch(function () { return []; })).filter(function (c) { return ids.indexOf(c.id) !== -1; });
    if (!list.length) { empty.classList.remove("hide"); return; }
    empty.insertAdjacentHTML("beforebegin", list.map(function (c) {
      var inCart = H.cart.has("course", c.id);
      return '<div class="card" data-wishlist-row="' + c.id + '" style="padding:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
        '<a href="course-detail.html?id=' + c.id + '" style="width:96px;height:60px;border-radius:8px;flex-shrink:0;background:' + esc(c.icon_bg) + ';"></a>' +
        '<div style="flex-grow:1;min-width:160px;"><a href="course-detail.html?id=' + c.id + '" style="font-size:14px;font-weight:600;display:block;">' + esc(c.title) + '</a><div style="font-size:12px;color:var(--ink-soft);">' + esc(c.instructor_name) + "</div></div>" +
        '<div style="font-size:15px;font-weight:700;">' + H.money(c.price) + "</div>" +
        '<button class="btn btn-primary" style="height:36px;" data-move="' + c.id + '"' + (inCart ? " disabled" : "") + ">" + (inCart ? "In cart" : "Move to cart") + "</button>" +
        '<button data-remove="' + c.id + '" aria-label="Remove" style="color:var(--ink-faint);padding:6px;">' + X + "</button></div>";
    }).join(""));
    panel.querySelectorAll("[data-move]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = list.find(function (x) { return x.id === Number(b.dataset.move); });
        H.cart.add("course", c); H.wishlist.toggle(c.id); H.toast("“" + c.title + "” moved to your cart."); renderWishlist(); renderOverview();
      });
    });
    panel.querySelectorAll("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () { H.wishlist.toggle(Number(b.dataset.remove)); renderWishlist(); renderOverview(); });
    });
  }

  /* ---------- Orders ---------- */
  async function renderOrders() {
    var orders = await H.api.myOrders().catch(function () { return []; });
    var badges = { paid: "badge-success", pending: "badge-amber", refunded: "badge-neutral" };
    $("[data-orders]").innerHTML = orders.map(function (o, i) {
      return '<div style="display:grid;grid-template-columns:110px 1fr 90px 100px 90px;padding:16px 20px;font-size:13px;align-items:center;' + (i < orders.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '" class="history-row">' +
        '<span style="color:var(--ink-soft);">' + fmtDate(o.created_at) + "</span>" +
        '<span style="font-weight:500;">' + o.items.map(function (it) { return esc(it.title) + (it.kind === "bundle" ? " (bundle)" : ""); }).join(", ") + "</span>" +
        "<span>" + H.money(o.amount_cents / 100) + "</span>" +
        '<span><span class="badge ' + (badges[o.status] || "badge-neutral") + '">' + esc(o.status) + "</span></span>" +
        '<span style="color:var(--ink-faint);">#' + o.id + "</span></div>";
    }).join("") || '<div style="padding:32px 20px;color:var(--ink-faint);font-size:14px;">No purchases yet.</div>';
  }

  /* ---------- Learner setup: nudges + per-course settings ---------- */
  var learnStates = {}; // course id → /api/learn state
  async function loadLearnStates() {
    var flagged = courses.filter(function (c) { return c.features && c.features.learner_setup; });
    await Promise.all(flagged.map(async function (c) {
      try { learnStates[c.id] = await H.api.learn(c.id); } catch (e) {}
    }));
    renderNudges(flagged);
    initLearnForm(flagged);
  }
  function renderNudges(flagged) {
    var box = $("[data-nudges]");
    box.innerHTML = flagged.map(function (c) {
      var st = learnStates[c.id];
      if (!st) return "";
      if (!st.settings) return '<div class="notice" style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><span>\u201C' + esc(c.title) + '\u201D is waiting for your setup.</span><a class="btn btn-primary btn-sm" href="setup.html?course=' + c.id + '">Set up & start</a></div>';
      if (!st.nudge) return "";
      return '<div class="notice" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;' + (st.nudge.tone === "done" ? "background:var(--success-tint);color:var(--success);" : "") + '">' +
        "<span><strong>" + esc(c.title) + ":</strong> " + esc(st.nudge.text) + "</span>" +
        '<span style="display:flex;gap:10px;align-items:center;">' + (st.streak.streak ? '<span class="streak-pill">\uD83D\uDD25 ' + st.streak.streak + "-day streak</span>" : "") +
        (st.nudge.tone === "due" ? '<a class="btn btn-primary btn-sm" href="lesson.html?course=' + c.id + '">Do today\u2019s lesson</a>' : "") + "</span></div>";
    }).join("");
    flagged.forEach(function (c) { if (learnStates[c.id] && learnStates[c.id].nudge) H.api.event("nudge_shown", c.id, { tone: learnStates[c.id].nudge.tone, where: "dashboard" }); });
  }
  function initLearnForm(flagged) {
    var f = $("[data-learn-form]");
    var withSetup = flagged.filter(function (c) { return learnStates[c.id] && learnStates[c.id].settings; });
    if (!withSetup.length) { f.classList.add("hide"); return; }
    f.classList.remove("hide");
    var opts = learnStates[withSetup[0].id].options;
    var fill = function (name) {
      f[name].innerHTML = Object.keys(opts[name]).map(function (k) { var o = opts[name][k]; return '<option value="' + k + '"' + (o.stub ? " disabled" : "") + ">" + esc(o.label) + " \u2014 " + esc(o.tagline) + "</option>"; }).join("");
    };
    fill("pace"); fill("practice"); fill("track");
    f.course.innerHTML = withSetup.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + "</option>"; }).join("");
    var sync = function () {
      var st = learnStates[Number(f.course.value)];
      f.pace.value = st.settings.pace; f.practice.value = st.settings.practice; f.track.value = st.settings.track;
      $("[data-learn-setup-link]").href = "setup.html?course=" + f.course.value;
    };
    f.course.addEventListener("change", sync);
    sync();
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var id = Number(f.course.value);
      try {
        learnStates[id] = await H.api.learnSettings(id, { pace: f.pace.value, practice: f.practice.value, track: f.track.value });
        H.toast("Learning setup saved for \u201C" + withSetup.find(function (c) { return c.id === id; }).title + "\u201D.");
        renderNudges(flagged);
      } catch (err) { var b = $("[data-learn-error]"); b.textContent = err.message; b.classList.remove("hide"); }
    });
  }

  /* ---------- Settings ---------- */
  function initSettings() {
    var pf = $("[data-profile-form]"), pwf = $("[data-password-form]");
    pf.name.value = me.name;
    $("#set-email").value = me.email;
    pf.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!H.validate(pf, { name: H.rules.required("Your name") })) return;
      try {
        me = await H.api.updateMe({ name: pf.name.value.trim() });
        H.session.set(me); fillMe(); H.toast("Profile saved.");
      } catch (err) { var b = $("[data-profile-error]"); b.textContent = err.message; b.classList.remove("hide"); }
    });
    pwf.addEventListener("submit", async function (e) {
      e.preventDefault();
      var ok = H.validate(pwf, { current: H.rules.required("Current password"), password: function (v) { return v.length < 10 ? "Use at least 10 characters." : (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) ? "Mix letters and numbers." : ""; } });
      if (!ok) return;
      try {
        await H.api.changePassword({ current: pwf.current.value, password: pwf.password.value });
        pwf.reset(); H.toast("Password updated.");
      } catch (err) { var b2 = $("[data-password-error]"); b2.textContent = err.message; b2.classList.remove("hide"); }
    });
  }

  function fillMe() {
    var first = me.name.split(" ")[0];
    document.querySelectorAll("[data-me-first]").forEach(function (el) { el.textContent = first; });
    document.querySelectorAll("[data-me-name]").forEach(function (el) { el.textContent = me.name; });
    document.querySelectorAll("[data-me-initials]").forEach(function (el) { el.textContent = H.initials(me.name); });
    document.querySelectorAll("[data-me-role]").forEach(function (el) { el.textContent = me.role === "admin" ? "Admin" : me.role === "instructor" ? "Instructor" : "Learner"; });
  }

  /* ---------- Boot ---------- */
  (async function () {
    me = await H.session.get();
    if (!me) return H.session.requireLogin("dashboard.html" + location.search);
    fillMe();
    courses = await H.api.myCourses().catch(function () { return []; });
    renderOverview(); renderCourses(); renderCertificates(); renderWishlist(); renderOrders(); initSettings(); loadLearnStates();
    var wanted = H.getParam("tab");
    var target = wanted && document.querySelector('[data-tab-group="dashboard"][data-tab="' + wanted + '"]');
    if (target) target.click();
  })();
})();
