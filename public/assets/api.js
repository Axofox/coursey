/* =========================================================
   Coursehub — data layer + shared UI helpers
   Talks to /api (netlify/functions/api.mjs). Reads are public;
   admin writes send the token kept in sessionStorage.
   Cart and wishlist live in localStorage (no accounts yet).
   ========================================================= */
window.Coursehub = (function () {
  "use strict";

  var API = "/api";
  var TOKEN_KEY = "coursehub-admin-token";
  var CART_KEY = "coursehub-cart";
  var WISHLIST_KEY = "coursehub-wishlist";

  /* ---------- Admin token ---------- */
  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  /* ---------- HTTP ---------- */
  async function request(method, path, body) {
    var headers = {};
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try { headers["X-Timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}

    var res;
    try {
      res = await fetch(API + path, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      var offline = new Error("You appear to be offline. Check your connection and try again.");
      offline.status = 0;
      throw offline;
    }
    if (res.status === 204) return null;
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || "Request failed (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== "" && params[k] !== false && params[k] !== null) {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  var api = {
    categories: function () { return request("GET", "/categories"); },
    courses: function (params) { return request("GET", "/courses" + qs(params)); },
    course: function (id) { return request("GET", "/courses/" + encodeURIComponent(id)); },
    bundles: function (params) { return request("GET", "/bundles" + qs(params)); },
    bundle: function (id) { return request("GET", "/bundles/" + encodeURIComponent(id)); },
    stats: function () { return request("GET", "/stats"); },
    submitReview: function (data) { return request("POST", "/reviews", data); },
    submitApplication: function (data) { return request("POST", "/applications", data); },

    checkToken: function () { return request("GET", "/auth/check"); },
    // accounts
    signup: function (data) { return request("POST", "/auth/signup", data); },
    login: function (data) { return request("POST", "/auth/login", data); },
    logout: function () { return request("POST", "/auth/logout", {}); },
    me: function () { return request("GET", "/auth/me"); },
    updateMe: function (data) { return request("PUT", "/auth/me", data); },
    changePassword: function (data) { return request("PUT", "/auth/password", data); },
    forgot: function (email) { return request("POST", "/auth/forgot", { email: email }); },
    reset: function (data) { return request("POST", "/auth/reset", data); },
    // learning
    myCourses: function () { return request("GET", "/me/courses"); },
    myOrders: function () { return request("GET", "/me/orders"); },
    myCertificates: function () { return request("GET", "/me/certificates"); },
    myInstructor: function () { return request("GET", "/me/instructor"); },
    myCourseList: function () { return request("GET", "/courses?mine=1"); },
    myReviews: function () { return request("GET", "/reviews?mine=1"); },
    enrol: function (courseId) { return request("POST", "/enrol", { course_id: courseId }); },
    progress: function (courseId, section, lesson) { return request("POST", "/progress", { course_id: courseId, section: section, lesson: lesson }); },
    certificate: function (id) { return request("GET", "/certificates/" + encodeURIComponent(id)); },
    order: function (id) { return request("GET", "/orders/" + id); },
    allOrders: function () { return request("GET", "/orders?all=1"); },
    checkout: function (items) { return request("POST", "/checkout", { items: items }); },
    users: function () { return request("GET", "/users"); },
    // learner setup (feature-flagged per course)
    learn: function (courseId) { return request("GET", "/learn/" + courseId); },
    learnSettings: function (courseId, settings) { return request("PUT", "/learn/" + courseId + "/settings", settings); },
    learnQuiz: function (courseId, kind, sectionIdx, answers) { return request("POST", "/learn/" + courseId + "/quiz", { kind: kind, section_idx: sectionIdx, answers: answers }); },
    learnExercise: function (courseId, sectionIdx) { return request("POST", "/learn/" + courseId + "/exercise", { section_idx: sectionIdx }); },
    event: function (name, courseId, props) { return request("POST", "/events", { name: name, course_id: courseId, props: props || {} }).catch(function () {}); },
    experiment: function () { return request("GET", "/experiment"); },
    updateUser: function (id, role) { return request("PUT", "/users/" + id, { role: role }); },
    deleteUser: function (id) { return request("DELETE", "/users/" + id); },
    createCourse: function (data) { return request("POST", "/courses", data); },
    updateCourse: function (id, data) { return request("PUT", "/courses/" + id, data); },
    deleteCourse: function (id) { return request("DELETE", "/courses/" + id); },
    createCategory: function (data) { return request("POST", "/categories", data); },
    updateCategory: function (id, data) { return request("PUT", "/categories/" + encodeURIComponent(id), data); },
    deleteCategory: function (id) { return request("DELETE", "/categories/" + encodeURIComponent(id)); },
    createBundle: function (data) { return request("POST", "/bundles", data); },
    updateBundle: function (id, data) { return request("PUT", "/bundles/" + id, data); },
    deleteBundle: function (id) { return request("DELETE", "/bundles/" + id); },
    reviews: function (status) { return request("GET", "/reviews" + qs({ status: status })); },
    updateReview: function (id, status) { return request("PUT", "/reviews/" + id, { status: status }); },
    deleteReview: function (id) { return request("DELETE", "/reviews/" + id); },
    applications: function () { return request("GET", "/applications"); },
    updateApplication: function (id, status) { return request("PUT", "/applications/" + id, { status: status }); },
    deleteApplication: function (id) { return request("DELETE", "/applications/" + id); },
  };

  /* ---------- localStorage lists ---------- */
  function readList(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; }
  }
  function writeList(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) {}
  }

  /* ---------- Cart: courses and bundles, keyed by "course-1" / "bundle-2" ---------- */
  function cartKey(kind, id) { return kind + "-" + id; }
  // Entries without a key come from an older cart format and are dropped
  function readCart() { return readList(CART_KEY).filter(function (i) { return i && i.key; }); }
  var cart = {
    items: readCart,
    has: function (kind, id) { return readCart().some(function (i) { return i.key === cartKey(kind, id); }); },
    add: function (kind, item) {
      var items = readCart();
      var key = cartKey(kind, item.id);
      if (items.some(function (i) { return i.key === key; })) return;
      items.push({
        key: key, kind: kind, id: item.id, title: item.title || item.name, price: item.price,
        subtitle: kind === "bundle" ? item.courses.length + " courses" : item.instructor_name,
        icon_bg: kind === "bundle" ? (item.courses[0] || {}).icon_bg : item.icon_bg,
        href: (kind === "bundle" ? "bundle.html?id=" : "course-detail.html?id=") + item.id,
      });
      writeList(CART_KEY, items);
      updateCartBadges();
    },
    remove: function (key) {
      writeList(CART_KEY, readCart().filter(function (i) { return i.key !== key; }));
      updateCartBadges();
    },
    clear: function () { writeList(CART_KEY, []); updateCartBadges(); },
  };
  function updateCartBadges() {
    var n = readCart().length;
    document.querySelectorAll("[data-cart-badge]").forEach(function (el) {
      el.textContent = n;
      el.classList.toggle("hide", !n);
    });
    document.querySelectorAll("[data-cart-link]").forEach(function (el) {
      el.setAttribute("aria-label", "Cart, " + n + " item" + (n === 1 ? "" : "s"));
    });
  }

  /* ---------- Wishlist (course ids) ---------- */
  var wishlist = {
    ids: function () { return readList(WISHLIST_KEY); },
    has: function (id) { return readList(WISHLIST_KEY).indexOf(Number(id)) !== -1; },
    toggle: function (id) {
      id = Number(id);
      var ids = readList(WISHLIST_KEY);
      var i = ids.indexOf(id);
      if (i === -1) ids.push(id); else ids.splice(i, 1);
      writeList(WISHLIST_KEY, ids);
      updateWishlistHearts();
      return i === -1;
    },
  };
  var HEART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
  function heartButton(id, extraStyle) {
    return '<button type="button" class="heart' + (wishlist.has(id) ? " is-active" : "") + '" data-wishlist-toggle data-course-id="' + id + '" aria-label="Save to wishlist" aria-pressed="' + wishlist.has(id) + '" style="' + (extraStyle || "") + '">' + HEART + "</button>";
  }
  function updateWishlistHearts() {
    document.querySelectorAll("[data-wishlist-toggle][data-course-id]").forEach(function (btn) {
      var on = wishlist.has(btn.getAttribute("data-course-id"));
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
  // Delegated so hearts inside freshly rendered cards just work
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-wishlist-toggle]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var id = btn.getAttribute("data-course-id");
    if (id) {
      var added = wishlist.toggle(id);
      toast(added ? "Saved to your wishlist." : "Removed from your wishlist.");
    } else {
      btn.classList.toggle("is-active"); // design reference pages without a course behind the card
    }
  });

  /* ---------- Toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---------- Form validation ----------
     validate(form, { fieldName: function (value, form) { return "" | "error text"; } })
     Shows the message under the field (an element with data-error-for="name",
     created if missing) and returns true when everything passes. */
  function validate(form, rules) {
    var ok = true;
    var first = null;
    Object.keys(rules).forEach(function (name) {
      var field = form.elements[name];
      if (!field) return;
      var value = field.type === "checkbox" ? field.checked : String(field.value || "").trim();
      var msg = rules[name](value, form) || "";
      var slot = form.querySelector('[data-error-for="' + name + '"]');
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "field-error";
        slot.setAttribute("data-error-for", name);
        field.insertAdjacentElement("afterend", slot);
      }
      slot.textContent = msg;
      slot.style.display = msg ? "" : "none";
      field.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg) { ok = false; if (!first) first = field; }
    });
    if (first) first.focus();
    return ok;
  }
  var rules = {
    required: function (label) { return function (v) { return v ? "" : (label || "This field") + " is required."; }; },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address."; },
    url: function (v) { return !v || /^https?:\/\/\S+$/i.test(v) ? "" : "Links must start with http:// or https://."; },
    minLength: function (n, label) { return function (v) { return v.length >= n ? "" : (label || "This") + " needs at least " + n + " characters."; }; },
    number: function (min, max, label) {
      return function (v) {
        if (v === "") return "";
        var n = Number(v);
        if (!Number.isFinite(n)) return (label || "This") + " must be a number.";
        if (min !== undefined && n < min) return (label || "This") + " must be at least " + min + ".";
        if (max !== undefined && n > max) return (label || "This") + " must be at most " + max + ".";
        return "";
      };
    },
  };

  /* ---------- Notifications panel (empty until accounts exist) ---------- */
  function initNotifications() {
    var bell = document.querySelector('.iconbtn[aria-label="Notifications"]');
    if (!bell) return;
    var panel = document.createElement("div");
    panel.className = "notif-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notifications");
    panel.innerHTML = '<div class="notif-head">Notifications</div>' +
      '<div class="notif-empty">You’re all caught up.<br><span>Course updates and replies will show up here once you have an account.</span></div>';
    bell.style.position = "relative";
    bell.setAttribute("aria-expanded", "false");
    bell.insertAdjacentElement("afterend", panel);
    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      bell.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", function (e) {
      if (!panel.contains(e.target)) { panel.classList.remove("open"); bell.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { panel.classList.remove("open"); bell.setAttribute("aria-expanded", "false"); }
    });
  }

  /* ---------- Session ----------
     session.get() resolves to the signed-in user or null (cached per page). */
  var sessionPromise = null;
  var session = {
    get: function (force) {
      if (!sessionPromise || force) {
        sessionPromise = api.me().catch(function () { return null; });
      }
      return sessionPromise;
    },
    set: function (user) { sessionPromise = Promise.resolve(user); renderAccountMenu(user); },
    requireLogin: function (next) {
      location.href = "login.html?next=" + encodeURIComponent(next || (location.pathname.split("/").pop() + location.search));
    },
  };

  var ACCOUNT_STYLE = "width:36px;height:36px;border-radius:999px;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;";
  function renderAccountMenu(user) {
    document.querySelectorAll("[data-account-menu]").forEach(function (slot) {
      if (!user) {
        slot.innerHTML = '<a class="navlink" href="login.html" style="margin-right:4px;">Sign in</a>' +
          '<a class="btn btn-primary btn-sm" href="signup.html" style="height:36px;">Sign up</a>';
        return;
      }
      var studio = user.role === "instructor" || user.role === "admin";
      slot.innerHTML = '<div class="account-menu">' +
        '<button class="account-avatar" style="' + ACCOUNT_STYLE + '" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">' + esc(initials(user.name)) + "</button>" +
        '<div class="account-dropdown" role="menu">' +
          '<div class="account-head"><div style="font-weight:600;font-size:14px;">' + esc(user.name) + '</div><div style="font-size:12px;color:var(--ink-faint);">' + esc(user.email) + "</div></div>" +
          '<a role="menuitem" href="dashboard.html">My learning</a>' +
          '<a role="menuitem" href="dashboard.html?tab=wishlist">Wishlist</a>' +
          (studio ? '<a role="menuitem" href="seller-dashboard.html">Instructor Studio</a>' : '<a role="menuitem" href="teach.html">Teach on Coursehub</a>') +
          (user.role === "admin" ? '<a role="menuitem" href="admin-dashboard.html">Platform admin</a>' : "") +
          '<a role="menuitem" href="dashboard.html?tab=settings">Settings</a>' +
          '<button role="menuitem" data-signout>Sign out</button>' +
        "</div></div>";
      var btn = slot.querySelector(".account-avatar"), menu = slot.querySelector(".account-dropdown");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = !menu.classList.contains("open");
        menu.classList.toggle("open", open);
        btn.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", function () { menu.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); });
      slot.querySelector("[data-signout]").addEventListener("click", async function () {
        try { await api.logout(); } catch (e) {}
        setToken("");
        session.set(null);
        location.href = "index.html";
      });
    });
  }

  /* ---------- Render helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(n) {
    n = Number(n);
    return "$" + (Number.isInteger(n) ? n : n.toFixed(2));
  }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }
  function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("") || "?";
  }
  var STAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"></path></svg>';
  var BOOK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';

  function stars(n) {
    var out = "";
    for (var i = 1; i <= 5; i++) out += '<span style="' + (i <= Math.round(n) ? "" : "opacity:.25;") + '">' + STAR + "</span>";
    return '<div class="stars" aria-label="' + Number(n).toFixed(1) + ' out of 5">' + out + "</div>";
  }

  function badgeHtml(badge, extraStyle) {
    if (!badge) return "";
    var style = badge === "New"
      ? "background:var(--success-tint);color:var(--success);"
      : "background:var(--amber-tint);color:var(--amber);";
    return '<span class="badge" style="' + style + (extraStyle || "") + '">' + esc(badge) + "</span>";
  }

  function ratingHtml(course) {
    if (!course.rating_count) {
      return '<span style="font-size:12px;color:var(--ink-faint);">No ratings yet</span>';
    }
    return '<div class="stars">' + STAR + "</div>" +
      '<span style="font-size:12px;font-weight:600;">' + Number(course.rating).toFixed(1) + "</span>" +
      '<span style="font-size:12px;color:var(--ink-faint);">(' + num(course.rating_count) + ")</span>";
  }

  // Course card — same markup as the design's featured grid, plus a wishlist heart
  function courseCard(c) {
    return '<a href="course-detail.html?id=' + c.id + '" class="card course-card" style="overflow:hidden;display:flex;flex-direction:column;">' +
      '<div style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;position:relative;background:' + esc(c.icon_bg) + ";color:" + esc(c.icon_color) + ';">' +
        BOOK + badgeHtml(c.badge, "position:absolute;top:12px;left:12px;") +
        heartButton(c.id, "position:absolute;top:8px;right:8px;") +
      "</div>" +
      '<div style="padding:16px;display:flex;flex-direction:column;gap:8px;flex-grow:1;">' +
        '<div style="font-size:15px;font-weight:600;line-height:1.35;">' + esc(c.title) + "</div>" +
        '<div style="font-size:13px;color:var(--ink-soft);">' + esc(c.instructor_name) + "</div>" +
        '<div style="display:flex;align-items:center;gap:6px;">' + ratingHtml(c) + "</div>" +
        '<div style="display:flex;align-items:baseline;gap:8px;margin-top:auto;padding-top:4px;">' +
          '<span style="font-size:17px;font-weight:700;">' + money(c.price) + "</span>" +
          (c.original_price && c.original_price > c.price
            ? '<span style="font-size:13px;color:var(--ink-faint);text-decoration:line-through;">' + money(c.original_price) + "</span>" : "") +
        "</div>" +
      "</div></a>";
  }

  // "m:ss" or "mm:ss" → seconds
  function durationSeconds(d) {
    if (!d) return 0;
    var parts = String(d).split(":").map(Number);
    return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 60;
  }
  function formatDuration(seconds) {
    var h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h && m) return h + "h " + (m < 10 ? "0" : "") + m + "m";
    if (h) return h + "h";
    return m + "m";
  }
  function curriculumTotals(curriculum) {
    var lessons = 0, seconds = 0;
    (curriculum || []).forEach(function (s) {
      (s.lessons || []).forEach(function (l) { lessons++; seconds += durationSeconds(l.duration); });
    });
    return { sections: (curriculum || []).length, lessons: lessons, seconds: seconds, label: formatDuration(seconds) };
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateCartBadges();
    updateWishlistHearts();
    initNotifications();
    if (document.querySelector("[data-account-menu]")) session.get().then(renderAccountMenu);
  });

  return {
    api: api, cart: cart, wishlist: wishlist, session: session, getToken: getToken, setToken: setToken,
    toast: toast, validate: validate, rules: rules,
    esc: esc, money: money, num: num, initials: initials, STAR: STAR, stars: stars,
    badgeHtml: badgeHtml, courseCard: courseCard, heartButton: heartButton,
    durationSeconds: durationSeconds, formatDuration: formatDuration, curriculumTotals: curriculumTotals,
    getParam: getParam,
  };
})();
