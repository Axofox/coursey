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

  var state = { categories: [], courses: [], editingCategory: null, swatch: 0 };

  /* ---------- Toast / errors ---------- */
  var toast = document.createElement("div");
  toast.className = "toast";
  document.body.appendChild(toast);
  function notify(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }
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
      var results = await Promise.all([H.api.categories(), H.api.courses({ all: 1 })]);
      state.categories = results[0];
      state.courses = results[1];
    } catch (e) {
      return handleFailure(e);
    }
    renderCourses();
    renderCategories();
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
