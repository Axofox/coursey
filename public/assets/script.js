/* =========================================================
   Coursehub — Shared interaction layer (vanilla JS, no deps)
   Covers every page: theme toggle, tabs, pill groups, cart
   maths and the course-editor stepper, each guarded by element
   existence checks so this one file can be included everywhere.
   (Accordions, wishlist and add-to-cart moved to the page scripts
   that render that markup.)
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     1. THEME (dark / light) — persisted in localStorage,
        applied via [data-theme] on <html> before first paint
        (see the inline snippet in <head> of every page).
  --------------------------------------------------------- */
  function initTheme() {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    toggles.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var root = document.documentElement;
        var isDark = root.getAttribute("data-theme") === "dark";
        var next = isDark ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("coursehub-theme", next); } catch (e) {}
      });
    });
  }

  /* ---------------------------------------------------------
     2. TABS
     Markup contract:
       <button data-tab-group="g1" data-tab="overview" class="... active">Overview</button>
       <div data-tab-group="g1" data-tab-panel="overview">...</div>
     Clicking a [data-tab] button shows the matching
     [data-tab-panel] in the same group and hides the rest.
  --------------------------------------------------------- */
  function initTabs() {
    var buttons = document.querySelectorAll("[data-tab]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.getAttribute("data-tab-group");
        var target = btn.getAttribute("data-tab");

        document.querySelectorAll('[data-tab-group="' + group + '"][data-tab]').forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        document.querySelectorAll('[data-tab-group="' + group + '"][data-tab-panel]').forEach(function (p) {
          var show = p.getAttribute("data-tab-panel") === target;
          p.classList.toggle("hide", !show);
        });
      });
    });
  }

  /* ---------------------------------------------------------
     4. PILL GROUPS (single-select chips / filters)
     Markup contract:
       <button data-pill-group="cat" data-pill="design" class="pill active">Design</button>
     Selecting one pill deselects its siblings in the same
     group. Pass data-pill-multi="true" on the group's parent
     wrapper to allow multi-select instead.
  --------------------------------------------------------- */
  function initPills() {
    document.querySelectorAll("[data-pill]").forEach(function (pill) {
      pill.addEventListener("click", function () {
        var group = pill.getAttribute("data-pill-group");
        var wrapper = pill.closest("[data-pill-multi]");
        var multi = wrapper && wrapper.getAttribute("data-pill-multi") === "true";

        if (multi) {
          pill.classList.toggle("active");
        } else {
          document.querySelectorAll('[data-pill-group="' + group + '"][data-pill]').forEach(function (p) {
            p.classList.toggle("active", p === pill);
          });
        }
      });
    });
  }

  /* ---------------------------------------------------------
     6. CART MATH (subtotal / discount / tax / total)
     Markup contract: cart rows carry data-cart-price + a
     data-remove-row button; a promo input with
     data-promo-input and a totals block with
     data-cart-subtotal / data-cart-discount / data-cart-tax /
     data-cart-total elements.
  --------------------------------------------------------- */
  function initCart() {
    var rows = document.querySelectorAll("[data-cart-row]");
    if (!rows.length) return;

    var subtotalEl = document.querySelector("[data-cart-subtotal]");
    var discountRow = document.querySelector("[data-discount-row]");
    var discountEl = document.querySelector("[data-cart-discount]");
    var taxEl = document.querySelector("[data-cart-tax]");
    var totalEl = document.querySelector("[data-cart-total]");
    var payBtn = document.querySelector("[data-pay-total]");
    var promoBtn = document.querySelector("[data-promo-apply]");
    var itemCountEl = document.querySelector("[data-cart-count]");
    var emptyState = document.querySelector("[data-cart-empty]");
    var list = document.querySelector("[data-cart-list]");

    var promoActive = false;
    var TAX_RATE = 0.08;

    function fmt(n) { return "$" + Math.round(n); }

    function recalc() {
      var visibleRows = document.querySelectorAll('[data-cart-row]:not(.hide)');
      var subtotal = 0;
      visibleRows.forEach(function (row) {
        subtotal += parseFloat(row.getAttribute("data-cart-price")) || 0;
      });
      var discount = promoActive ? Math.round(subtotal * 0.1) : 0;
      var tax = Math.round((subtotal - discount) * TAX_RATE);
      var total = subtotal - discount + tax;

      if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
      if (discountEl) discountEl.textContent = "-" + fmt(discount);
      if (taxEl) taxEl.textContent = fmt(tax);
      if (totalEl) totalEl.textContent = fmt(total);
      if (payBtn) payBtn.textContent = "Pay " + fmt(total);
      if (discountRow) discountRow.classList.toggle("hide", !promoActive);
      if (itemCountEl) itemCountEl.textContent = visibleRows.length;

      if (emptyState && list) {
        var isEmpty = visibleRows.length === 0;
        emptyState.classList.toggle("hide", !isEmpty);
        list.classList.toggle("hide", isEmpty);
      }
    }

    document.querySelectorAll("[data-remove-row]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-cart-row]");
        if (row) {
          row.classList.add("hide");
          recalc();
        }
      });
    });

    if (promoBtn) {
      promoBtn.addEventListener("click", function () {
        promoActive = !promoActive;
        promoBtn.textContent = promoActive ? "PROMO10 applied" : "Apply";
        promoBtn.style.color = promoActive ? "var(--success)" : "";
        promoBtn.style.borderColor = promoActive ? "var(--success)" : "";
        recalc();
      });
    }

    recalc();
  }

  /* ---------------------------------------------------------
     7. PAYMENT METHOD TABS (Card / PayPal / Apple Pay) reuse
        the generic tab pattern (data-tab-group="payment"),
        no extra JS needed beyond initTabs().
  --------------------------------------------------------- */

  /* ---------------------------------------------------------
     8. COURSE-UPLOAD STEPPER
     Markup contract:
       <button data-step-goto="2">...</button>
       <div data-step-panel="1"> ... </div>
       Next/back buttons: data-step-next / data-step-back
       Step dots get .is-active / .is-done classes.
  --------------------------------------------------------- */
  function initStepper() {
    var panels = document.querySelectorAll("[data-step-panel]");
    if (!panels.length) return;
    var total = panels.length;
    var current = 1;

    function render() {
      panels.forEach(function (p) {
        p.classList.toggle("hide", parseInt(p.getAttribute("data-step-panel"), 10) !== current);
      });
      document.querySelectorAll("[data-step-dot]").forEach(function (dot) {
        var n = parseInt(dot.getAttribute("data-step-dot"), 10);
        dot.classList.toggle("is-active", n === current);
        dot.classList.toggle("is-done", n < current);
      });
      document.querySelectorAll("[data-step-label]").forEach(function (label) {
        var n = parseInt(label.getAttribute("data-step-label"), 10);
        label.classList.toggle("is-active", n === current);
      });
      document.querySelectorAll("[data-step-back]").forEach(function (btn) {
        btn.classList.toggle("hide", current === 1);
      });
      document.querySelectorAll("[data-step-next]").forEach(function (btn) {
        btn.classList.toggle("hide", current === total);
      });
      document.querySelectorAll("[data-step-publish]").forEach(function (btn) {
        btn.classList.toggle("hide", current !== total);
      });
    }

    document.querySelectorAll("[data-step-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        current = parseInt(btn.getAttribute("data-step-goto"), 10);
        render();
      });
    });
    document.querySelectorAll("[data-step-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (current < total) current++;
        render();
      });
    });
    document.querySelectorAll("[data-step-back]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (current > 1) current--;
        render();
      });
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initTabs();
    initPills();
    initCart();
    initStepper();
  });
})();
