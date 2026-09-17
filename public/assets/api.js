/* =========================================================
   Coursehub — data layer + shared render helpers
   Talks to /api (netlify/functions/api.mjs). Reads are public;
   admin writes send the token kept in sessionStorage.
   The cart lives in localStorage (no accounts yet).
   ========================================================= */
window.Coursehub = (function () {
  "use strict";

  var API = "/api";
  var TOKEN_KEY = "coursehub-admin-token";
  var CART_KEY = "coursehub-cart";

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

    var res = await fetch(API + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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
    stats: function () { return request("GET", "/stats"); },

    checkToken: function () { return request("GET", "/auth/check"); },
    createCourse: function (data) { return request("POST", "/courses", data); },
    updateCourse: function (id, data) { return request("PUT", "/courses/" + id, data); },
    deleteCourse: function (id) { return request("DELETE", "/courses/" + id); },
    createCategory: function (data) { return request("POST", "/categories", data); },
    updateCategory: function (id, data) { return request("PUT", "/categories/" + encodeURIComponent(id), data); },
    deleteCategory: function (id) { return request("DELETE", "/categories/" + encodeURIComponent(id)); },
  };

  /* ---------- Cart (localStorage) ---------- */
  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
    updateCartBadges();
  }
  var cart = {
    items: readCart,
    has: function (id) { return readCart().some(function (i) { return i.id === id; }); },
    add: function (course) {
      var items = readCart();
      if (items.some(function (i) { return i.id === course.id; })) return;
      items.push({
        id: course.id, title: course.title, instructor_name: course.instructor_name,
        price: course.price, icon_bg: course.icon_bg,
      });
      writeCart(items);
    },
    remove: function (id) { writeCart(readCart().filter(function (i) { return i.id !== id; })); },
    clear: function () { writeCart([]); },
  };
  function updateCartBadges() {
    var n = readCart().length;
    document.querySelectorAll("[data-cart-badge]").forEach(function (el) {
      el.textContent = n;
      el.style.display = n ? "" : "none";
    });
    document.querySelectorAll("[data-cart-link]").forEach(function (el) {
      el.setAttribute("aria-label", "Cart, " + n + " item" + (n === 1 ? "" : "s"));
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

  // Course card — same markup as the design's featured grid
  function courseCard(c) {
    return '<a href="course-detail.html?id=' + c.id + '" class="card" style="overflow:hidden;display:flex;flex-direction:column;">' +
      '<div style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;position:relative;background:' + esc(c.icon_bg) + ";color:" + esc(c.icon_color) + ';">' +
        BOOK + badgeHtml(c.badge, "position:absolute;top:12px;left:12px;") +
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

  document.addEventListener("DOMContentLoaded", updateCartBadges);

  return {
    api: api, cart: cart, getToken: getToken, setToken: setToken,
    esc: esc, money: money, num: num, initials: initials, STAR: STAR, BOOK: BOOK,
    badgeHtml: badgeHtml, ratingHtml: ratingHtml, courseCard: courseCard,
    durationSeconds: durationSeconds, formatDuration: formatDuration, curriculumTotals: curriculumTotals,
    getParam: getParam, updateCartBadges: updateCartBadges,
  };
})();
