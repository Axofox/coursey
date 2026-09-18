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

  var notify = H.toast;
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
  var role = "admin"; // or "instructor" — decides which controls show
  var tokenMode = false;
  $("[data-login-mode]").addEventListener("click", function () {
    tokenMode = !tokenMode;
    $("[data-login-account]").classList.toggle("hide", tokenMode);
    $("[data-login-token]").classList.toggle("hide", !tokenMode);
    this.textContent = tokenMode ? "Sign in with an account instead" : "Use the admin token instead";
  });
  $("[data-login-form]").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = e.target;
    try {
      if (tokenMode) {
        var token = form.token.value.trim();
        if (!token) return;
        H.setToken(token);
        await H.api.checkToken();
        role = "admin";
      } else {
        if (!H.validate(form, { email: H.rules.email, password: H.rules.required("Password") })) return;
        var user = await H.api.login({ email: form.email.value.trim(), password: form.password.value });
        H.session.set(user);
        if (user.role === "learner") {
          await H.api.logout().catch(function () {});
          H.session.set(null);
          return showApp(false, "Only instructors and admins can create courses. Apply on the Teach page first.");
        }
        role = user.role;
      }
      form.reset();
      showApp(true);
      boot();
    } catch (err) {
      H.setToken("");
      showApp(false, err.status === 401 ? (tokenMode ? "That token isn\u2019t right." : "Wrong email or password.") : "Couldn\u2019t reach the server: " + err.message);
    }
  });

  $("[data-editor-form]").addEventListener("submit", function (e) { e.preventDefault(); });

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
            return '<div data-lesson="' + li + '" style="border-bottom:1px solid var(--border);padding-bottom:8px;">' +
              '<div class="lesson-row">' +
                '<input class="input" type="text" placeholder="Lesson title" value="' + esc(l.title) + '" data-lesson-title>' +
                '<input class="input duration" type="text" placeholder="m:ss" value="' + esc(l.duration) + '" data-lesson-duration aria-label="Length (m:ss)">' +
                '<button type="button" class="iconbtn" aria-label="Remove lesson" data-remove-lesson>' + X + "</button>" +
              "</div>" +
              '<div class="lesson-row" style="margin-top:6px;">' +
                '<input class="input" type="url" placeholder="Video link (YouTube, Vimeo or .mp4) \u2014 optional" value="' + esc(l.video_url || "") + '" data-lesson-video style="font-size:13px;height:38px;">' +
                '<label style="display:flex;align-items:center;gap:6px;margin:0;white-space:nowrap;font-size:12px;"><input type="checkbox" data-lesson-preview' + (l.preview ? " checked" : "") + "> Free preview</label>" +
              "</div>" +
              '<div class="field-error" data-lesson-error style="display:none;"></div>' +
            "</div>";
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
        sections[si].lessons.push({ title: "", duration: "", video_url: "", preview: false });
        renderSections();
        var rows = wrap.querySelectorAll('[data-section="' + si + '"] [data-lesson-title]');
        rows[rows.length - 1].focus();
      });
      el.querySelectorAll("[data-lesson]").forEach(function (row) {
        var li = Number(row.dataset.lesson);
        row.querySelector("[data-lesson-title]").addEventListener("input", function () { sections[si].lessons[li].title = this.value; });
        row.querySelector("[data-lesson-duration]").addEventListener("input", function () { sections[si].lessons[li].duration = this.value.trim(); });
        row.querySelector("[data-lesson-video]").addEventListener("input", function () { sections[si].lessons[li].video_url = this.value.trim(); });
        row.querySelector("[data-lesson-preview]").addEventListener("change", function () { sections[si].lessons[li].preview = this.checked; });
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
      return { title: s.title, lessons: (s.lessons || []).map(function (l) { return { title: l.title, duration: l.duration || "", video_url: l.video_url || "", preview: !!l.preview }; }) };
    });
    renderList("learn"); renderList("requirements"); renderSections(); updateThumb();
  }

  // Inline validation: returns the first step with a problem, or 0 when clean
  function validateAll() {
    var form = $("[data-editor-form]");
    var basics = H.validate(form, {
      title: H.rules.required("A course title"),
      category_id: H.rules.required("A category"),
    });
    var pricing = H.validate(form, {
      price: H.rules.number(0, undefined, "Price"),
      original_price: function (v) {
        var base = H.rules.number(0, undefined, "Compare-at price")(v);
        if (base) return base;
        return v !== "" && Number(v) <= Number(getField("price") || 0) ? "Compare-at price should be higher than the price." : "";
      },
      rating: H.rules.number(0, 5, "Rating"),
      rating_count: H.rules.number(0, undefined, "Number of ratings"),
      students: H.rules.number(0, undefined, "Students"),
      resources: H.rules.number(0, undefined, "Resources"),
    });
    var curriculumOk = true;
    document.querySelectorAll("[data-lesson]").forEach(function (row) {
      var msgs = [];
      var d = row.querySelector("[data-lesson-duration]").value.trim();
      var v = row.querySelector("[data-lesson-video]").value.trim();
      if (d && !/^\d{1,3}(:[0-5]\d)?$/.test(d)) msgs.push("Length must look like 12:30.");
      if (v && !/^https?:\/\/\S+$/i.test(v)) msgs.push("Video link must start with http:// or https://.");
      var slot = row.querySelector("[data-lesson-error]");
      slot.textContent = msgs.join(" ");
      slot.style.display = msgs.length ? "" : "none";
      if (msgs.length) curriculumOk = false;
    });
    if (!basics) return 1;
    if (!curriculumOk) return 2;
    if (!pricing) return 3;
    return 0;
  }

  var saving = false;
  async function save(published) {
    if (saving) return;
    var badStep = validateAll();
    if (badStep) {
      document.querySelector('[data-step-goto="' + badStep + '"]').click();
      return showError("Please fix the highlighted field" + (badStep === 2 ? "s in the curriculum" : "") + " (step " + badStep + ").");
    }
    var data = collect();
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
      if (published && saved.status === "pending") {
        notify("“" + saved.title + "” was submitted for review.");
        setTimeout(function () { location.href = "seller-dashboard.html"; }, 900);
      } else {
        notify(published ? "“" + saved.title + "” is live." : "Draft saved.");
        if (published) setTimeout(function () { location.href = "course-detail.html?id=" + courseId; }, 900);
      }
    } catch (e) {
      if (e.status === 401) { H.setToken(""); showApp(false, "Your session expired — please sign in again."); }
      else showError(e.message);
    } finally {
      saving = false;
    }
  }
  document.querySelectorAll("[data-save-draft]").forEach(function (b) { b.addEventListener("click", function () { save(false); }); });
  $("[data-publish]").addEventListener("click", function () { save(true); });

  function applyRole() {
    var instructor = role === "instructor";
    document.querySelectorAll("[data-admin-only]").forEach(function (el) { el.classList.toggle("hide", instructor); });
    $("[data-publish]").textContent = instructor ? "Submit for review" : "Publish course";
    $("[data-publish-note]").textContent = instructor
      ? "Submitting sends the course to the Coursehub team for a quick review. You\u2019ll get an email when it\u2019s live, and you can keep editing meanwhile."
      : "Publishing makes the course visible on the homepage and in search immediately. You can unpublish it any time from the admin console.";
    $("[data-back-link]").href = instructor ? "seller-dashboard.html" : "admin-dashboard.html?tab=courses";
    $("[data-back-label]").textContent = instructor ? "Instructor Studio" : "Platform admin";
  }

  async function boot() {
    applyRole();
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
    var user = await H.session.get();
    if (user && user.role !== "learner") { role = user.role; showApp(true); return boot(); }
    if (H.getToken()) {
      try { await H.api.checkToken(); role = "admin"; showApp(true); return boot(); } catch (e) { H.setToken(""); }
    }
    showApp(false, user ? "Only instructors and admins can create courses. Apply on the Teach page first." : "");
  })();
})();
