/* Platform admin — token sign-in, course catalog table, category manager */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var $ = function (sel) { return document.querySelector(sel); };

  var app = $("[data-admin-app]");
  var login = $("[data-admin-login]");
  if (!app || !login) return;

  var PALETTE = [
    ["#EDEBFB", "#7A6DF0"], ["#E3F1FB", "#3E93C9"], ["#FDEEDC", "#C98A3E"],
    ["#FBE7EC", "#C9698A"], ["#E4F3EA", "#3E9C6B"], ["#FFF6DD", "#B79A2E"],
    ["#E7F5EC", "#1F8A4C"], ["#FBEAE6", "#C4432E"], ["#FFE6DC", "#C8431F"],
  ];

  var state = {
    categories: [], courses: [], bundles: [], reviews: [], applications: [],
    editingCategory: null, swatch: 0, editingBundle: null, reviewFilter: "pending",
  };

  /* ---------- Toast / errors ---------- */
  var notify = H.toast;
  function showError(msg) {
    var el = $("[data-admin-error]");
    el.textContent = msg || "";
    el.classList.toggle("hide", !msg);
  }

  function handleFailure(e) {
    if (e.status === 401) {
      H.setToken("");
      showApp(false, "Your session expired — please sign in again.");
    } else {
      showError(e.message);
    }
  }

  /* ---------- Sign in ---------- */
  function showApp(authed, message) {
    login.classList.toggle("hide", authed);
    app.classList.toggle("hide", !authed);
    var err = $("[data-login-error]");
    err.textContent = message || "";
    err.classList.toggle("hide", !message);
  }

  $("[data-login-form]").addEventListener("submit", async function (e) {
    e.preventDefault();
    var input = e.target.token;
    var token = input.value.trim();
    if (!token) return;
    H.setToken(token);
    try {
      await H.api.checkToken();
      input.value = "";
      showApp(true);
      refresh();
    } catch (err) {
      H.setToken("");
      showApp(false, err.status === 401 ? "That token isn’t right." : "Couldn’t reach the server: " + err.message);
    }
  });
  $("[data-signout]").addEventListener("click", function () {
    H.setToken("");
    showApp(false);
  });

  /* ---------- Data ---------- */
  async function refresh() {
    showError("");
    try {
      var results = await Promise.all([
        H.api.categories(), H.api.courses({ all: 1 }), H.api.bundles({ all: 1 }),
        H.api.reviews(), H.api.applications(),
      ]);
      state.categories = results[0];
      state.courses = results[1];
      state.bundles = results[2];
      state.reviews = results[3];
      state.applications = results[4];
    } catch (e) {
      return handleFailure(e);
    }
    renderCourses();
    renderCategories();
    renderBundles();
    renderReviews();
    renderApplications();
    renderOverview();
    renderReports();
  }

  function timeAgo(iso) {
    var s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  /* ---------- Overview ---------- */
  function renderOverview() {
    var pendingReviews = state.reviews.filter(function (r) { return r.status === "pending"; }).length;
    var newApps = state.applications.filter(function (a) { return a.status === "new"; }).length;
    var set = function (k, v) { var el = $('[data-ov="' + k + '"]'); if (el) el.textContent = v; };
    set("courses", state.courses.filter(function (c) { return c.published; }).length);
    set("drafts", state.courses.filter(function (c) { return !c.published; }).length);
    set("reviews", pendingReviews);
    set("applications", newApps);
    $('[data-ov-card="reviews"]').style.borderColor = pendingReviews ? "var(--amber)" : "";
    $('[data-ov-card="applications"]').style.borderColor = newApps ? "var(--amber)" : "";
    var badge = $("[data-pending-reviews]");
    badge.textContent = pendingReviews; badge.classList.toggle("hide", !pendingReviews);
    var abadge = $("[data-new-applications]");
    abadge.textContent = newApps; abadge.classList.toggle("hide", !newApps);

    var events = []
      .concat(state.reviews.map(function (r) { return { at: r.created_at, kind: r.status === "pending" ? "amber" : "success", text: "Review by " + r.name + " on \u201C" + r.course_title + "\u201D" + (r.status === "pending" ? " is waiting for approval" : " was approved"), tab: "reviews" }; }))
      .concat(state.applications.map(function (a) { return { at: a.created_at, kind: "info", text: "Instructor application from " + a.name + " (" + a.expertise + ")", tab: "instructors" }; }))
      .concat(state.courses.map(function (c) { return { at: c.updated_at, kind: "neutral", text: "Course \u201C" + c.title + "\u201D " + (c.published ? "updated" : "saved as draft"), tab: "courses" }; }))
      .sort(function (a, b) { return new Date(b.at) - new Date(a.at); }).slice(0, 8);
    var colors = { amber: ["#FCF1DE", "#B7791F"], success: ["#E7F5EC", "#1F8A4C"], info: ["#E3F1FB", "#3E93C9"], neutral: ["var(--surface-alt)", "var(--ink-soft)"] };
    $("[data-activity]").innerHTML = events.map(function (ev, i) {
      var col = colors[ev.kind];
      return '<button style="display:flex;align-items:center;gap:14px;padding:16px 20px;width:100%;text-align:left;' + (i < events.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '" data-open-tab="' + ev.tab + '">' +
        '<div style="width:10px;height:10px;border-radius:999px;flex-shrink:0;background:' + col[1] + ';"></div>' +
        '<div style="flex-grow:1;font-size:13px;">' + esc(ev.text) + "</div>" +
        '<span style="font-size:12px;color:var(--ink-faint);white-space:nowrap;">' + timeAgo(ev.at) + "</span></button>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">Nothing yet.</div>';
    $("[data-activity]").querySelectorAll("[data-open-tab]").forEach(function (b) {
      b.addEventListener("click", function () { openTab(b.dataset.openTab); });
    });
  }
  function openTab(name) {
    var t = document.querySelector('[data-tab-group="admin"][data-tab="' + name + '"]');
    if (t) t.click();
  }

  /* ---------- Bundles ---------- */
  var bundleForm = $("[data-bundle-form]");
  function renderBundles() {
    var rows = $("[data-bundle-rows]");
    rows.innerHTML = state.bundles.map(function (b) {
      return '<div class="trow" style="grid-template-columns:2fr 0.7fr 0.9fr 1.2fr;">' +
        '<div class="tcell" style="gap:12px;"><div style="display:flex;flex-shrink:0;">' +
          b.courses.slice(0, 3).map(function (c, i) { return '<div class="thumb" style="width:28px;height:28px;border-radius:8px;background:' + esc(c.icon_bg) + ";" + (i ? "margin-left:-10px;" : "") + '"></div>'; }).join("") +
          '</div><div><a href="bundle.html?id=' + b.id + '" style="font-weight:500;">' + esc(b.name) + "</a>" +
          '<div style="font-size:12px;color:var(--ink-faint);">' + b.courses.length + " course" + (b.courses.length === 1 ? "" : "s") + " \u00B7 worth " + H.money(b.total_value) + "</div></div></div>" +
        '<div class="tcell" style="font-weight:600;">' + H.money(b.price) + "</div>" +
        '<div class="tcell">' + (b.published ? '<span class="badge badge-success">Published</span>' : '<span class="badge badge-neutral">Draft</span>') + "</div>" +
        '<div class="tcell" style="gap:14px;">' +
          '<button class="link-btn" data-edit-bundle="' + b.id + '">Edit</button>' +
          '<button class="link-btn" data-toggle-bundle="' + b.id + '">' + (b.published ? "Unpublish" : "Publish") + "</button>" +
          '<button class="link-btn danger" data-delete-bundle="' + b.id + '">Delete</button>' +
        "</div></div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">No bundles yet.</div>';

    rows.querySelectorAll("[data-edit-bundle]").forEach(function (b) {
      b.addEventListener("click", function () { setBundleForm(state.bundles.find(function (x) { return x.id === Number(b.dataset.editBundle); })); });
    });
    rows.querySelectorAll("[data-toggle-bundle]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var bundle = state.bundles.find(function (x) { return x.id === Number(b.dataset.toggleBundle); });
        try { await H.api.updateBundle(bundle.id, { published: !bundle.published }); notify(bundle.published ? "Bundle unpublished." : "Bundle is live."); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
    rows.querySelectorAll("[data-delete-bundle]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var bundle = state.bundles.find(function (x) { return x.id === Number(b.dataset.deleteBundle); });
        if (!confirm("Delete the bundle \u201C" + bundle.name + "\u201D? Courses in it are not affected.")) return;
        try { await H.api.deleteBundle(bundle.id); notify("Bundle deleted."); if (state.editingBundle === bundle.id) setBundleForm(null); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
    renderBundleCourseChoices();
  }
  function renderBundleCourseChoices(selected) {
    var box = $("[data-bundle-courses]");
    var chosen = selected || bundleSelected();
    box.innerHTML = state.courses.filter(function (c) { return c.published; }).map(function (c) {
      return '<label style="display:flex;align-items:center;gap:10px;margin:0;font-weight:500;font-size:13px;color:var(--ink);">' +
        '<input type="checkbox" name="course_ids" value="' + c.id + '"' + (chosen.indexOf(c.id) !== -1 ? " checked" : "") + '> ' +
        '<span class="thumb" style="width:22px;height:14px;background:' + esc(c.icon_bg) + ';"></span>' + esc(c.title) +
        '<span style="margin-left:auto;color:var(--ink-faint);font-weight:400;">' + H.money(c.price) + "</span></label>";
    }).join("") || '<span style="font-size:13px;color:var(--ink-faint);">Publish some courses first.</span>';
    box.querySelectorAll("input").forEach(function (i) { i.addEventListener("change", updateBundleTotal); });
    updateBundleTotal();
  }
  function bundleSelected() {
    return Array.prototype.map.call($("[data-bundle-courses]").querySelectorAll("input:checked"), function (i) { return Number(i.value); });
  }
  function updateBundleTotal() {
    var ids = bundleSelected();
    var total = state.courses.filter(function (c) { return ids.indexOf(c.id) !== -1; }).reduce(function (n, c) { return n + c.price; }, 0);
    var price = Number(bundleForm.price.value || 0);
    $("[data-bundle-total]").textContent = ids.length
      ? ids.length + " course" + (ids.length === 1 ? "" : "s") + " worth " + H.money(total) + (price && total > price ? " \u2014 saves " + Math.round((1 - price / total) * 100) + "%" : "")
      : "";
  }
  bundleForm.price.addEventListener("input", updateBundleTotal);
  function setBundleForm(b) {
    state.editingBundle = b ? b.id : null;
    bundleForm.name.value = b ? b.name : "";
    bundleForm.description.value = b ? b.description : "";
    bundleForm.price.value = b ? b.price : "";
    renderBundleCourseChoices(b ? b.course_ids : []);
    $("[data-bundle-form-title]").textContent = b ? "Edit \u201C" + b.name + "\u201D" : "Add a bundle";
    $("[data-bundle-submit]").textContent = b ? "Save changes" : "Add bundle";
    $("[data-bundle-cancel]").classList.toggle("hide", !b);
    if (b) { openTab("bundles"); bundleForm.name.focus(); }
  }
  $("[data-bundle-cancel]").addEventListener("click", function () { setBundleForm(null); });
  bundleForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var ids = bundleSelected();
    var ok = H.validate(bundleForm, {
      name: H.rules.required("A bundle name"),
      price: function (v) { return v === "" ? "A price is required." : H.rules.number(0, undefined, "Price")(v); },
    });
    var idsErr = $('[data-error-for="course_ids"]');
    idsErr.textContent = ids.length < 2 ? "Pick at least two courses." : "";
    idsErr.style.display = ids.length < 2 ? "" : "none";
    if (!ok || ids.length < 2) return;
    var data = { name: bundleForm.name.value.trim(), description: bundleForm.description.value.trim(), price: Number(bundleForm.price.value), course_ids: ids };
    try {
      if (state.editingBundle) { await H.api.updateBundle(state.editingBundle, data); notify("Bundle updated."); }
      else { await H.api.createBundle(data); notify("Bundle added \u2014 it\u2019s on the homepage now."); }
      setBundleForm(null);
      refresh();
    } catch (err) { handleFailure(err); }
  });

  /* ---------- Reviews ---------- */
  document.querySelectorAll("[data-review-filter]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.reviewFilter = b.dataset.reviewFilter;
      document.querySelectorAll("[data-review-filter]").forEach(function (x) { x.classList.toggle("active", x === b); });
      renderReviews();
    });
  });
  function renderReviews() {
    var rows = $("[data-review-rows]");
    var list = state.reviews.filter(function (r) { return r.status === state.reviewFilter; });
    rows.innerHTML = list.map(function (r, i) {
      return '<div style="padding:18px 20px;' + (i < list.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:10px;"><strong style="font-size:14px;">' + esc(r.name) + "</strong>" + H.stars(r.rating) +
            '<span style="font-size:12px;color:var(--ink-faint);">on <a href="course-detail.html?id=' + r.course_id + '" style="color:var(--ink-soft);">' + esc(r.course_title) + "</a> \u00B7 " + timeAgo(r.created_at) + "</span></div>" +
          '<div style="display:flex;gap:14px;">' +
            (r.status === "pending"
              ? '<button class="link-btn" style="color:var(--success);" data-review-status="approved" data-id="' + r.id + '">Approve</button>'
              : '<button class="link-btn" data-review-status="pending" data-id="' + r.id + '">Unpublish</button>') +
            '<button class="link-btn danger" data-review-delete="' + r.id + '">Delete</button>' +
          "</div></div>" +
        '<p style="font-size:14px;color:var(--ink-soft);line-height:1.6;">' + esc(r.body) + "</p></div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">' + (state.reviewFilter === "pending" ? "No reviews waiting for approval." : "No approved reviews yet.") + "</div>";
    rows.querySelectorAll("[data-review-status]").forEach(function (b) {
      b.addEventListener("click", async function () {
        try { await H.api.updateReview(Number(b.dataset.id), b.dataset.reviewStatus); notify(b.dataset.reviewStatus === "approved" ? "Review published." : "Review hidden."); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
    rows.querySelectorAll("[data-review-delete]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Delete this review?")) return;
        try { await H.api.deleteReview(Number(b.dataset.reviewDelete)); notify("Review deleted."); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
  }

  /* ---------- Instructor applications ---------- */
  function renderApplications() {
    var rows = $("[data-application-rows]");
    var badges = { new: "badge-amber", approved: "badge-success", rejected: "badge-neutral" };
    rows.innerHTML = state.applications.map(function (a, i) {
      return '<div style="padding:18px 20px;' + (i < state.applications.length - 1 ? "border-bottom:1px solid var(--border);" : "") + '">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px;">' +
          '<div><strong style="font-size:14px;">' + esc(a.name) + '</strong> <span class="badge ' + badges[a.status] + '" style="margin-left:6px;">' + esc(a.status) + "</span>" +
            '<div style="font-size:12px;color:var(--ink-faint);margin-top:2px;"><a href="mailto:' + esc(a.email) + '" style="color:var(--ink-soft);">' + esc(a.email) + "</a>" +
            (a.portfolio_url ? ' \u00B7 <a href="' + esc(a.portfolio_url) + '" target="_blank" rel="noopener" style="color:var(--accent-strong);">Portfolio</a>' : "") + " \u00B7 " + timeAgo(a.created_at) + "</div></div>" +
          '<div style="display:flex;gap:14px;">' +
            (a.status !== "approved" ? '<button class="link-btn" style="color:var(--success);" data-app-status="approved" data-id="' + a.id + '">Approve</button>' : "") +
            (a.status !== "rejected" ? '<button class="link-btn" data-app-status="rejected" data-id="' + a.id + '">Reject</button>' : "") +
            '<button class="link-btn danger" data-app-delete="' + a.id + '">Delete</button>' +
          "</div></div>" +
        '<div style="font-size:13px;font-weight:600;margin-bottom:4px;">Would teach: ' + esc(a.expertise) + "</div>" +
        (a.bio ? '<p style="font-size:13px;color:var(--ink-soft);line-height:1.6;">' + esc(a.bio) + "</p>" : "") +
      "</div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">No applications yet.</div>';
    rows.querySelectorAll("[data-app-status]").forEach(function (b) {
      b.addEventListener("click", async function () {
        try { await H.api.updateApplication(Number(b.dataset.id), b.dataset.appStatus); notify("Application " + b.dataset.appStatus + "."); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
    rows.querySelectorAll("[data-app-delete]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Delete this application?")) return;
        try { await H.api.deleteApplication(Number(b.dataset.appDelete)); notify("Application deleted."); refresh(); }
        catch (e) { handleFailure(e); }
      });
    });
  }

  /* ---------- Reports: single-hue magnitude bars, one row per value ---------- */
  function bars(pairs) {
    var max = pairs.reduce(function (m, p) { return Math.max(m, p[1]); }, 0) || 1;
    return pairs.map(function (p) {
      return '<div class="bar-row" title="' + esc(p[0]) + ": " + p[1] + '">' +
        '<span style="color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p[0]) + "</span>" +
        '<div class="progress-track"><div class="progress-fill" style="width:' + Math.round(p[1] / max * 100) + '%;"></div></div>' +
        '<span class="val">' + p[1] + "</span></div>";
    }).join("") || '<p style="font-size:13px;color:var(--ink-faint);">No data yet.</p>';
  }
  function renderReports() {
    var pub = state.courses.filter(function (c) { return c.published; });
    var byCat = state.categories.map(function (k) { return [k.name, pub.filter(function (c) { return c.category_id === k.id; }).length]; });
    var byLevel = ["Beginner", "Intermediate", "Advanced"].map(function (l) { return [l, pub.filter(function (c) { return c.level === l; }).length]; });
    var bands = [["Free", 0, 0], ["$1\u2013$29", 1, 29], ["$30\u2013$59", 30, 59], ["$60\u2013$99", 60, 99], ["$100+", 100, Infinity]];
    var byPrice = bands.map(function (b) { return [b[0], pub.filter(function (c) { return c.price >= b[1] && c.price <= b[2]; }).length]; });
    var approved = state.reviews.filter(function (r) { return r.status === "approved"; });
    var byRating = [5, 4, 3, 2, 1].map(function (n) { return [n + " star" + (n === 1 ? "" : "s"), approved.filter(function (r) { return r.rating === n; }).length]; });
    $('[data-report="by-category"]').innerHTML = bars(byCat);
    $('[data-report="by-level"]').innerHTML = bars(byLevel);
    $('[data-report="by-price"]').innerHTML = bars(byPrice);
    $('[data-report="by-rating"]').innerHTML = approved.length ? bars(byRating) : '<p style="font-size:13px;color:var(--ink-faint);">No approved reviews yet.</p>';
  }

  /* ---------- Courses table ---------- */
  function renderCourses() {
    $("[data-course-count]").textContent = state.courses.length;
    var rows = $("[data-course-rows]");
    if (!state.courses.length) {
      rows.innerHTML = '<div class="tcell" style="color:var(--ink-faint);">No courses yet — create the first one.</div>';
      return;
    }
    rows.innerHTML = state.courses.map(function (c) {
      return '<div class="trow" style="grid-template-columns:2.4fr 1.2fr 1fr 0.7fr 1.1fr 1.3fr;min-width:900px;" data-course-row="' + c.id + '">' +
        '<div class="tcell" style="gap:12px;"><div class="thumb" style="background:' + esc(c.icon_bg) + ';"></div>' +
          '<a href="course-detail.html?id=' + c.id + '" style="font-weight:500;">' + esc(c.title) + "</a></div>" +
        '<div class="tcell" style="color:var(--ink-soft);">' + esc(c.instructor_name || "—") + "</div>" +
        '<div class="tcell" style="color:var(--ink-soft);">' + esc(c.category_name) + "</div>" +
        '<div class="tcell" style="font-weight:600;">' + H.money(c.price) + "</div>" +
        '<div class="tcell">' + (c.published
          ? '<span class="badge badge-success">Published</span>'
          : '<span class="badge badge-neutral">Draft</span>') +
          (c.featured ? ' <span class="badge badge-accent" style="margin-left:6px;">Featured</span>' : "") + "</div>" +
        '<div class="tcell" style="gap:14px;">' +
          '<a class="link-btn" href="course-upload.html?id=' + c.id + '">Edit</a>' +
          '<button class="link-btn" data-toggle-publish="' + c.id + '">' + (c.published ? "Unpublish" : "Publish") + "</button>" +
          '<button class="link-btn danger" data-delete-course="' + c.id + '">Delete</button>' +
        "</div></div>";
    }).join("");

    rows.querySelectorAll("[data-toggle-publish]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var c = state.courses.find(function (x) { return x.id === Number(btn.dataset.togglePublish); });
        try {
          await H.api.updateCourse(c.id, { published: !c.published });
          notify(c.published ? "“" + c.title + "” is now a draft." : "“" + c.title + "” is live.");
          refresh();
        } catch (e) { handleFailure(e); }
      });
    });
    rows.querySelectorAll("[data-delete-course]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var c = state.courses.find(function (x) { return x.id === Number(btn.dataset.deleteCourse); });
        if (!confirm("Delete “" + c.title + "”? This can’t be undone.")) return;
        try {
          await H.api.deleteCourse(c.id);
          notify("“" + c.title + "” deleted.");
          refresh();
        } catch (e) { handleFailure(e); }
      });
    });
  }

  /* ---------- Categories ---------- */
  function renderCategories() {
    var rows = $("[data-category-rows]");
    rows.innerHTML = state.categories.map(function (c) {
      return '<div class="trow" style="grid-template-columns:2fr 0.8fr 1.1fr;">' +
        '<div class="tcell" style="gap:12px;"><div class="thumb" style="width:34px;background:' + esc(c.icon_bg) + ';"></div>' +
          '<div><div style="font-weight:500;">' + esc(c.name) + "</div>" +
          (c.description ? '<div style="font-size:12px;color:var(--ink-faint);">' + esc(c.description) + "</div>" : "") + "</div></div>" +
        '<div class="tcell" style="color:var(--ink-soft);">' + c.course_count + "</div>" +
        '<div class="tcell" style="gap:14px;">' +
          '<button class="link-btn" data-edit-category="' + esc(c.id) + '">Edit</button>' +
          '<button class="link-btn danger" data-delete-category="' + esc(c.id) + '">Delete</button>' +
        "</div></div>";
    }).join("") || '<div class="tcell" style="color:var(--ink-faint);">No categories yet.</div>';

    rows.querySelectorAll("[data-edit-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setCategoryForm(state.categories.find(function (c) { return c.id === btn.dataset.editCategory; }));
      });
    });
    rows.querySelectorAll("[data-delete-category]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var c = state.categories.find(function (x) { return x.id === btn.dataset.deleteCategory; });
        if (c.course_count) { showError("Move or delete the " + c.course_count + " course(s) in “" + c.name + "” first."); return; }
        if (!confirm("Delete the category “" + c.name + "”?")) return;
        try {
          await H.api.deleteCategory(c.id);
          notify("“" + c.name + "” deleted.");
          if (state.editingCategory === c.id) setCategoryForm(null);
          refresh();
        } catch (e) { handleFailure(e); }
      });
    });
  }

  var catForm = $("[data-category-form]");
  var swatches = $("[data-swatches]");
  swatches.innerHTML = PALETTE.map(function (p, i) {
    return '<button type="button" data-swatch="' + i + '" aria-label="Colour ' + (i + 1) + '" style="background:' + p[0] + ';"><span style="display:block;width:12px;height:12px;border-radius:4px;margin:0 auto;background:' + p[1] + ';"></span></button>';
  }).join("");
  function pickSwatch(i) {
    state.swatch = i;
    swatches.querySelectorAll("[data-swatch]").forEach(function (b) { b.classList.toggle("active", Number(b.dataset.swatch) === i); });
  }
  swatches.querySelectorAll("[data-swatch]").forEach(function (b) {
    b.addEventListener("click", function () { pickSwatch(Number(b.dataset.swatch)); });
  });

  function setCategoryForm(cat) {
    state.editingCategory = cat ? cat.id : null;
    catForm.name.value = cat ? cat.name : "";
    catForm.description.value = cat ? cat.description : "";
    var idx = cat ? PALETTE.findIndex(function (p) { return p[0].toLowerCase() === String(cat.icon_bg).toLowerCase(); }) : 0;
    pickSwatch(idx < 0 ? 0 : idx);
    $("[data-category-form-title]").textContent = cat ? "Edit “" + cat.name + "”" : "Add a category";
    $("[data-category-submit]").textContent = cat ? "Save changes" : "Add category";
    $("[data-category-cancel]").classList.toggle("hide", !cat);
    if (cat) catForm.name.focus();
  }
  $("[data-category-cancel]").addEventListener("click", function () { setCategoryForm(null); });

  catForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    var data = {
      name: catForm.name.value.trim(),
      description: catForm.description.value.trim(),
      icon_bg: PALETTE[state.swatch][0],
      icon_color: PALETTE[state.swatch][1],
    };
    if (!data.name) return;
    try {
      if (state.editingCategory) {
        await H.api.updateCategory(state.editingCategory, data);
        notify("“" + data.name + "” updated.");
      } else {
        await H.api.createCategory(data);
        notify("“" + data.name + "” added.");
      }
      setCategoryForm(null);
      refresh();
    } catch (err) { handleFailure(err); }
  });

  /* ---------- Deep link (?tab=courses); the page's own script swaps the title ---------- */
  var wanted = H.getParam("tab");
  if (wanted) {
    var target = document.querySelector('[data-tab-group="admin"][data-tab="' + wanted + '"]');
    if (target) document.addEventListener("DOMContentLoaded", function () { target.click(); });
  }

  /* ---------- Boot ---------- */
  setCategoryForm(null);
  (async function () {
    if (!H.getToken()) return showApp(false);
    try {
      await H.api.checkToken();
      showApp(true);
      refresh();
    } catch (e) {
      H.setToken("");
      showApp(false);
    }
  })();
})();
