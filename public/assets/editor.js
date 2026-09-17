/* Course editor — create (course-upload.html) or edit (course-upload.html?id=N) */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var $ = function (sel) { return document.querySelector(sel); };

  var app = $("[data-admin-app]");
  var login = $("[data-admin-login]");
  if (!app || !login) return;

  var courseId = Number(H.getParam("id")) || null;
  var categories = [];
  var lists = { learn: [], requirements: [] };
  var sections = [];   // [{ title, lessons: [{ title, duration }] }]
  var level = "Beginner";

  var X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

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
    var el = $("[data-editor-error]");
    el.textContent = msg || "";
    el.classList.toggle("hide", !msg);
    if (msg) window.scrollTo({ top: 0, behavior: "smooth" });
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
    var token = e.target.token.value.trim();
    if (!token) return;
    H.setToken(token);
    try {
      await H.api.checkToken();
      e.target.token.value = "";
      showApp(true);
      boot();
    } catch (err) {
      H.setToken("");
      showApp(false, err.status === 401 ? "That token isn’t right." : "Couldn’t reach the server: " + err.message);
    }
  });

  /* ---------- Simple fields ---------- */
  function field(name) { return $('[data-field="' + name + '"]'); }
  function getField(name) {
    var el = field(name);
    if (el.classList.contains("switch")) return el.getAttribute("aria-pressed") === "true";
    return el.value;
  }
  function setField(name, value) {
    var el = field(name);
    if (!el) return;
    if (el.classList.contains("switch")) el.setAttribute("aria-pressed", String(!!value));
    else el.value = value == null ? "" : value;
  }
  field("featured").addEventListener("click", function () {
    this.setAttribute("aria-pressed", String(this.getAttribute("aria-pressed") !== "true"));
  });

  // Level pills: script.js handles the active class; we just read it
  document.querySelectorAll('[data-pill-group="level"]').forEach(function (p) {
    p.addEventListener("click", function () { level = p.getAttribute("data-pill"); });
  });
  function setLevel(v) {
    level = v;
    document.querySelectorAll('[data-pill-group="level"]').forEach(function (p) {
      p.classList.toggle("active", p.getAttribute("data-pill") === v);
    });
  }

  function updateThumb() {
    var cat = categories.find(function (c) { return c.id === getField("category_id"); });
    $("[data-thumb-preview]").style.background = cat ? cat.icon_bg : "var(--surface-alt)";
  }
  field("category_id").addEventListener("change", updateThumb);

  /* ---------- String lists (learn / requirements) ---------- */
  function renderList(name) {
    var wrap = $('[data-list="' + name + '"]');
    wrap.innerHTML = lists[name].map(function (v, i) {
      return '<div class="row"><input class="input" type="text" value="' + esc(v) + '" data-idx="' + i + '">' +
        '<button type="button" class="iconbtn" aria-label="Remove" data-remove="' + i + '">' + X + "</button></div>";
    }).join("") || '<p style="font-size:13px;color:var(--ink-faint);">Nothing yet.</p>';
    wrap.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", function () { lists[name][Number(inp.dataset.idx)] = inp.value; });
    });
    wrap.querySelectorAll("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () { lists[name].splice(Number(b.dataset.remove), 1); renderList(name); });
    });
  }
  document.querySelectorAll("[data-add-item]").forEach(function (b) {
    b.addEventListener("click", function () {
      var name = b.dataset.addItem;
      lists[name].push("");
      renderList(name);
      var inputs = $('[data-list="' + name + '"]').querySelectorAll("input");
      inputs[inputs.length - 1].focus();
    });
  });

  /* ---------- Curriculum sections ---------- */
  function renderSections() {
    var wrap = $("[data-sections]");
    wrap.innerHTML = sections.map(function (s, si) {
      return '<div class="section-editor" data-section="' + si + '">' +
        '<div class="head">' +
          '<span style="font-size:13px;color:var(--ink-faint);flex-shrink:0;">' + (si + 1) + ".</span>" +
          '<input class="input" type="text" placeholder="Section title" value="' + esc(s.title) + '" data-section-title>' +
          '<button type="button" class="iconbtn" aria-label="Remove section" data-remove-section>' + X + "</button>" +
        "</div>" +
        '<div class="body">' +
          s.lessons.map(function (l, li) {
            return '<div class="lesson-row" data-lesson="' + li + '">' +
              '<input class="input" type="text" placeholder="Lesson title" value="' + esc(l.title) + '" data-lesson-title>' +
              '<input class="input duration" type="text" placeholder="m:ss" value="' + esc(l.duration) + '" data-lesson-duration>' +
              '<button type="button" class="iconbtn" aria-label="Remove lesson" data-remove-lesson>' + X + "</button></div>";
          }).join("") +
          '<button type="button" class="btn btn-secondary btn-sm" style="align-self:flex-start;margin-top:4px;" data-add-lesson>+ Add lesson</button>' +
        "</div></div>";
    }).join("") || '<p style="font-size:13px;color:var(--ink-faint);">No sections yet — add the first one.</p>';

    wrap.querySelectorAll("[data-section]").forEach(function (el) {
      var si = Number(el.dataset.section);
      el.querySelector("[data-section-title]").addEventListener("input", function () { sections[si].title = this.value; });
      el.querySelector("[data-remove-section]").addEventListener("click", function () {
        if (sections[si].lessons.length && !confirm("Remove this section and its " + sections[si].lessons.length + " lesson(s)?")) return;
        sections.splice(si, 1); renderSections();
      });
      el.querySelector("[data-add-lesson]").addEventListener("click", function () {
        sections[si].lessons.push({ title: "", duration: "" });
        renderSections();
        var rows = wrap.querySelectorAll('[data-section="' + si + '"] [data-lesson-title]');
        rows[rows.length - 1].focus();
      });
      el.querySelectorAll("[data-lesson]").forEach(function (row) {
        var li = Number(row.dataset.lesson);
        row.querySelector("[data-lesson-title]").addEventListener("input", function () { sections[si].lessons[li].title = this.value; });
        row.querySelector("[data-lesson-duration]").addEventListener("input", function () { sections[si].lessons[li].duration = this.value.trim(); });
        row.querySelector("[data-remove-lesson]").addEventListener("click", function () { sections[si].lessons.splice(li, 1); renderSections(); });
      });
    });
  }
  $("[data-add-section]").addEventListener("click", function () {
    sections.push({ title: "", lessons: [] });
    renderSections();
    var titles = $("[data-sections]").querySelectorAll("[data-section-title]");
    titles[titles.length - 1].focus();
  });

  /* ---------- Publish checklist ---------- */
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  function renderChecklist() {
    var d = collect();
    var t = H.curriculumTotals(d.curriculum);
    var items = [
      [!!d.title && !!d.subtitle, d.title ? "Title" + (d.subtitle ? " and subtitle" : " (subtitle missing)") + " complete" : "Title is required"],
      [!!d.instructor_name, d.instructor_name ? "Instructor: " + d.instructor_name : "No instructor name yet"],
      [t.lessons > 0, t.sections + " section" + (t.sections === 1 ? "" : "s") + " · " + t.lessons + " lesson" + (t.lessons === 1 ? "" : "s") + (t.seconds ? " · " + t.label : "")],
      [d.price > 0, d.price > 0 ? "Pricing set — " + H.money(d.price) : "Price is 0 — the course will be free"],
    ];
    $("[data-checklist]").innerHTML = items.map(function (it) {
      return '<div style="display:flex;align-items:center;gap:10px;font-size:14px;"><span style="color:' + (it[0] ? "var(--success)" : "var(--amber)") + ';">' + (it[0] ? CHECK : WARN) + "</span>" + esc(it[1]) + "</div>";
    }).join("");
  }
  document.querySelectorAll("[data-step-goto], [data-step-next], [data-step-back]").forEach(function (b) {
    b.addEventListener("click", renderChecklist);
  });

  /* ---------- Load / save ---------- */
  function collect() {
    return {
      title: getField("title").trim(),
      subtitle: getField("subtitle").trim(),
      description: getField("description").trim(),
      category_id: getField("category_id"),
      level: level,
      language: getField("language").trim() || "English",
      badge: getField("badge") || null,
      instructor_name: getField("instructor_name").trim(),
      instructor_title: getField("instructor_title").trim(),
      instructor_bio: getField("instructor_bio").trim(),
      price: Number(getField("price") || 0),
      original_price: getField("original_price") === "" ? null : Number(getField("original_price")),
      resources: Number(getField("resources") || 0),
      students: Number(getField("students") || 0),
      rating: Number(getField("rating") || 0),
      rating_count: Number(getField("rating_count") || 0),
      featured: getField("featured"),
      learn: lists.learn.map(function (s) { return s.trim(); }).filter(Boolean),
      requirements: lists.requirements.map(function (s) { return s.trim(); }).filter(Boolean),
      curriculum: sections
        .map(function (s) { return { title: s.title.trim(), lessons: s.lessons.filter(function (l) { return l.title.trim(); }) }; })
        .filter(function (s) { return s.title; }),
    };
  }

  function populate(c) {
    ["title", "subtitle", "description", "category_id", "language", "instructor_name", "instructor_title",
     "instructor_bio", "price", "original_price", "resources", "students", "rating", "rating_count"].forEach(function (k) {
      setField(k, c[k]);
    });
    setField("badge", c.badge || "");
    setField("featured", c.featured);
    setLevel(c.level || "Beginner");
    lists.learn = (c.learn || []).slice();
    lists.requirements = (c.requirements || []).slice();
    sections = (c.curriculum || []).map(function (s) {
      return { title: s.title, lessons: (s.lessons || []).map(function (l) { return { title: l.title, duration: l.duration || "" }; }) };
    });
    renderList("learn"); renderList("requirements"); renderSections(); updateThumb();
  }

  var saving = false;
  async function save(published) {
    if (saving) return;
    var data = collect();
    if (!data.title) return showError("A course title is required (step 1).");
    if (!data.category_id) return showError("Pick a category (step 1).");
    data.published = published;
    saving = true;
    showError("");
    try {
      var saved = courseId ? await H.api.updateCourse(courseId, data) : await H.api.createCourse(data);
      if (!courseId) {
        courseId = saved.id;
        history.replaceState(null, "", "course-upload.html?id=" + courseId);
        $("[data-editor-title]").textContent = "Edit “" + saved.title + "”";
      }
      notify(published ? "“" + saved.title + "” is live." : "Draft saved.");
      if (published) setTimeout(function () { location.href = "course-detail.html?id=" + courseId; }, 900);
    } catch (e) {
      if (e.status === 401) { H.setToken(""); showApp(false, "Your session expired — please sign in again."); }
      else showError(e.message);
    } finally {
      saving = false;
    }
  }
  document.querySelectorAll("[data-save-draft]").forEach(function (b) { b.addEventListener("click", function () { save(false); }); });
  $("[data-publish]").addEventListener("click", function () { save(true); });

  async function boot() {
    try {
      categories = await H.api.categories();
    } catch (e) {
      return showError("Couldn’t load categories: " + e.message);
    }
    field("category_id").innerHTML = categories.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>";
    }).join("");
    if (!categories.length) showError("Create a category in the admin console before adding courses.");

    if (courseId) {
      try {
        var c = await H.api.course(courseId);
        $("[data-editor-title]").textContent = "Edit “" + c.title + "”";
        document.title = "Edit " + c.title + " — Coursehub";
        populate(c);
      } catch (e) {
        showError(e.status === 404 ? "That course doesn’t exist." : e.message);
      }
    } else {
      populate({ level: "Intermediate", language: "English", featured: false, category_id: categories[0] && categories[0].id });
    }
  }

  (async function () {
    if (!H.getToken()) return showApp(false);
    try {
      await H.api.checkToken();
      showApp(true);
      boot();
    } catch (e) {
      H.setToken("");
      showApp(false);
    }
  })();
})();
