/* Home & catalog: categories, course grid (featured / by category / search), stats */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;

  var grid = document.querySelector("[data-course-grid]");
  var title = document.querySelector("[data-catalog-title]");
  var subtitle = document.querySelector("[data-catalog-subtitle]");
  var viewAll = document.querySelector("[data-catalog-viewall]");
  var catGrid = document.querySelector("[data-category-grid]");
  if (!grid) return;

  var categories = [];
  var current = { category: "", q: "", all: false };

  var BOOK_SM = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';

  function categoryCard(c) {
    var n = c.course_count;
    return '<a href="index.html?category=' + encodeURIComponent(c.id) + '#catalog" class="card" data-category-link="' + esc(c.id) + '" style="padding:20px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;">' +
      '<div style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:' + esc(c.icon_bg) + ";color:" + esc(c.icon_color) + ';">' + BOOK_SM + "</div>" +
      '<div style="font-size:13px;font-weight:600;">' + esc(c.name) + "</div>" +
      '<div style="font-size:12px;color:var(--ink-faint);">' + H.num(n) + " course" + (n === 1 ? "" : "s") + "</div></a>";
  }

  function setHeading() {
    var cat = categories.find(function (c) { return c.id === current.category; });
    if (current.q) {
      title.textContent = "Results for “" + current.q + "”";
      subtitle.textContent = cat ? "In " + cat.name : "Across all categories";
    } else if (cat) {
      title.textContent = cat.name + " courses";
      subtitle.textContent = cat.description || "Everything in " + cat.name;
    } else if (current.all) {
      title.textContent = "All courses";
      subtitle.textContent = "The full catalog";
    } else {
      title.textContent = "Featured courses";
      subtitle.textContent = "Hand-picked by our editors this week";
    }
    var filtered = current.q || current.category || current.all;
    viewAll.innerHTML = filtered ? "Back to featured ←" : "View all →";
    viewAll.href = filtered ? "index.html#catalog" : "index.html?all=1#catalog";
  }

  var loadSeq = 0;
  async function loadCourses() {
    var seq = ++loadSeq;
    setHeading();
    var params = { category: current.category, q: current.q };
    if (!current.q && !current.category && !current.all) params.featured = 1;
    var courses;
    try {
      courses = await H.api.courses(params);
    } catch (e) {
      if (seq !== loadSeq) return;
      grid.innerHTML = '<p style="color:var(--ink-faint);font-size:14px;">Couldn’t load courses right now. Please try again in a moment.</p>';
      return;
    }
    if (seq !== loadSeq) return;
    // Featured view falls back to the whole catalog if nothing is flagged featured yet
    if (params.featured && !courses.length) {
      try { courses = await H.api.courses({}); } catch (e) { courses = []; }
      if (seq !== loadSeq) return;
    }
    grid.innerHTML = courses.length
      ? courses.map(H.courseCard).join("")
      : '<p style="color:var(--ink-faint);font-size:14px;">No courses found' + (current.q ? " for “" + esc(current.q) + "”" : "") + ".</p>";
  }

  function applyState(push) {
    if (push) {
      var url = "index.html" + (current.category || current.q || current.all
        ? "?" + [current.category && "category=" + encodeURIComponent(current.category),
                 current.q && "q=" + encodeURIComponent(current.q),
                 current.all && "all=1"].filter(Boolean).join("&")
        : "");
      history.pushState(null, "", url + "#catalog");
    }
    document.querySelectorAll("[data-search-input]").forEach(function (i) { i.value = current.q; });
    document.querySelectorAll("[data-search-term]").forEach(function (p) {
      p.classList.toggle("active", p.getAttribute("data-search-term").toLowerCase() === current.q.toLowerCase());
    });
    loadCourses();
  }

  function readUrl() {
    current.category = H.getParam("category") || "";
    current.q = (H.getParam("q") || "").trim();
    current.all = H.getParam("all") === "1";
  }

  function search(q) {
    current.q = q.trim();
    current.all = false;
    applyState(true);
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelectorAll("[data-search-input]").forEach(function (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); search(input.value); }
    });
  });
  document.querySelectorAll("[data-search-term]").forEach(function (pill) {
    pill.addEventListener("click", function () { search(pill.getAttribute("data-search-term")); });
  });

  // Category cards and in-page catalog links update the grid without a reload
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-category-link], a[data-catalog-viewall]");
    if (!a) return;
    e.preventDefault();
    var url = new URL(a.href, location.href);
    current.category = url.searchParams.get("category") || "";
    current.q = "";
    current.all = url.searchParams.get("all") === "1";
    applyState(true);
    document.getElementById("catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("popstate", function () { readUrl(); applyState(false); });

  async function loadCategories() {
    try {
      categories = await H.api.categories();
      catGrid.innerHTML = categories.map(categoryCard).join("");
      catGrid.style.gridTemplateColumns = "repeat(" + Math.min(6, Math.max(categories.length, 1)) + ", minmax(0,1fr))";
    } catch (e) {
      catGrid.innerHTML = "";
    }
  }

  async function loadStats() {
    try {
      var s = await H.api.stats();
      var set = function (k, v) { var el = document.querySelector('[data-stat="' + k + '"]'); if (el) el.textContent = v; };
      set("courses", H.num(s.courses));
      set("instructors", H.num(s.instructors));
      set("students", H.num(s.students));
      set("avg_rating", s.avg_rating ? s.avg_rating.toFixed(1) + " / 5" : "—");
      var hero = document.querySelector("[data-hero-badge]");
      if (hero && s.courses) hero.textContent = H.num(s.courses) + " course" + (s.courses === 1 ? "" : "s") + " · " + H.num(s.instructors) + " instructor" + (s.instructors === 1 ? "" : "s");
    } catch (e) {}
  }

  readUrl();
  loadCategories().then(function () { applyState(false); });
  loadStats();
})();
