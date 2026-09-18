/* Course detail page — renders one course from the API in the design's markup */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc, money = H.money, num = H.num;

  var main = document.querySelector("[data-course-main]");
  var aside = document.querySelector("[data-course-aside]");
  var crumb = document.querySelector("[data-breadcrumb]");
  if (!main) return;

  var CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  var LESSON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"></circle><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"></polygon></svg>';
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var PLAY = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"></circle><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"></polygon></svg>';
  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

  function monthYear(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  var courseId = null, enrolledView = false;
  function sectionHtml(s, i) {
    var t = H.curriculumTotals([s]);
    var open = i === 0;
    return '<div style="border-bottom:1px solid var(--border);">' +
      '<button data-acc-toggle="s' + i + '" aria-expanded="' + open + '" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:16px 20px;text-align:left;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<span class="chev" style="color:var(--ink-faint);transition:transform .15s;' + (open ? "transform:rotate(180deg);" : "") + '">' + CHEVRON + "</span>" +
          '<span style="font-size:14px;font-weight:600;">' + (i + 1) + ". " + esc(s.title) + "</span>" +
        "</div>" +
        '<span style="font-size:13px;color:var(--ink-faint);">' + t.lessons + " lesson" + (t.lessons === 1 ? "" : "s") + (t.seconds ? " · " + t.label : "") + "</span>" +
      "</button>" +
      '<div data-acc-panel="s' + i + '" class="' + (open ? "" : "hide") + '" style="padding:0 20px 14px 52px;display:flex;flex-direction:column;gap:10px;">' +
        (s.lessons || []).map(function (l, li) {
          var label = LESSON + esc(l.title);
          return '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            (l.preview || enrolledView
              ? '<a href="lesson.html?course=' + courseId + '&s=' + i + '&l=' + li + '" style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--accent-strong);">' + label + (l.preview && !enrolledView ? ' <span class="badge badge-accent">Preview</span>' : "") + "</a>"
              : '<div style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-soft);">' + label + "</div>") +
            '<span style="font-size:12px;color:var(--ink-faint);">' + esc(l.duration) + "</span></div>";
        }).join("") +
      "</div></div>";
  }

  function render(c) {
    courseId = c.id;
    enrolledView = !!(c.enrolled || c.can_manage || c.price === 0);
    var totals = H.curriculumTotals(c.curriculum);
    var ini = H.initials(c.instructor_name);
    document.title = c.title + " — Coursehub";

    crumb.innerHTML = '<a href="index.html" style="color:var(--ink-faint);">Home</a><span>/</span>' +
      '<a href="index.html?category=' + encodeURIComponent(c.category_id) + '#catalog" style="color:var(--ink-faint);">' + esc(c.category_name) + "</a><span>/</span>" +
      '<span style="color:var(--ink-soft);">' + esc(c.title) + "</span>";

    main.innerHTML =
      '<div style="display:flex;gap:8px;margin-bottom:16px;">' + H.badgeHtml(c.badge) +
        '<span class="badge" style="background:var(--surface-alt);color:var(--ink-soft);">' + esc(c.level) + "</span>" +
        (c.status === "published" ? "" : c.status === "pending" ? '<span class="badge badge-amber">Awaiting review</span>' : '<span class="badge badge-danger">Draft — not visible to learners</span>') +
        (c.enrolled ? '<span class="badge badge-success">Enrolled</span>' : "") +
      "</div>" +
      '<h1 style="font-size:32px;line-height:1.2;margin-bottom:12px;">' + esc(c.title) + "</h1>" +
      (c.subtitle ? '<p style="font-size:16px;color:var(--ink-soft);line-height:1.6;margin-bottom:16px;">' + esc(c.subtitle) + "</p>" : "") +
      '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:22px;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          (c.rating_count
            ? '<div class="stars">' + H.STAR + '</div><span style="font-size:14px;font-weight:700;">' + Number(c.rating).toFixed(1) + '</span><span style="font-size:13px;color:var(--ink-faint);">(' + num(c.rating_count) + " ratings)</span>"
            : '<span style="font-size:13px;color:var(--ink-faint);">No ratings yet</span>') +
        "</div>" +
        (c.students ? '<span style="font-size:13px;color:var(--ink-faint);">' + num(c.students) + " students</span>" : "") +
        '<span style="font-size:13px;color:var(--ink-faint);">Updated ' + monthYear(c.updated_at) + "</span>" +
        '<span style="font-size:13px;color:var(--ink-faint);">' + esc(c.language) + "</span>" +
      "</div>" +
      (c.instructor_name ?
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:36px;">' +
          '<div style="width:44px;height:44px;border-radius:999px;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">' + esc(ini) + "</div>" +
          '<div><div style="font-size:14px;font-weight:600;">' + esc(c.instructor_name) + "</div>" +
          '<div style="font-size:13px;color:var(--ink-soft);">' + esc(c.instructor_title) + "</div></div></div>" : "") +

      (c.description ? '<p style="font-size:15px;color:var(--ink-soft);line-height:1.7;margin-bottom:32px;white-space:pre-line;">' + esc(c.description) + "</p>" : "") +

      (c.learn && c.learn.length ?
        '<div class="card" style="padding:28px;margin-bottom:32px;">' +
          '<h3 style="font-size:18px;margin-bottom:18px;">What you’ll learn</h3>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;" class="grid-outcomes">' +
            c.learn.map(function (t) {
              return '<div style="display:flex;gap:10px;align-items:flex-start;"><div class="check">' + CHECK + '</div><span style="font-size:14px;line-height:1.5;">' + esc(t) + "</span></div>";
            }).join("") +
          "</div></div>" : "") +

      (totals.sections ?
        '<div style="margin-bottom:32px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;">' +
            '<h3 style="font-size:18px;">Course content</h3>' +
            '<span style="font-size:13px;color:var(--ink-soft);">' + totals.sections + " section" + (totals.sections === 1 ? "" : "s") + " · " + totals.lessons + " lesson" + (totals.lessons === 1 ? "" : "s") + (totals.seconds ? " · " + totals.label : "") + "</span>" +
          "</div>" +
          '<div class="card" style="overflow:hidden;">' + c.curriculum.map(sectionHtml).join("") + "</div>" +
        "</div>" : "") +

      (c.requirements && c.requirements.length ?
        '<div style="margin-bottom:32px;"><h3 style="font-size:18px;margin-bottom:14px;">Requirements</h3>' +
          '<div style="display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--ink-soft);">' +
            c.requirements.map(function (r) { return "<div>· " + esc(r) + "</div>"; }).join("") +
          "</div></div>" : "") +

      (c.instructor_name ?
        '<div class="card" style="padding:28px;margin-bottom:32px;display:flex;gap:20px;">' +
          '<div style="width:64px;height:64px;border-radius:999px;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0;">' + esc(ini) + "</div>" +
          '<div><div style="font-size:16px;font-weight:600;margin-bottom:2px;">' + esc(c.instructor_name) + "</div>" +
          '<div style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">' + esc(c.instructor_title) + "</div>" +
          (c.instructor_bio ? '<p style="font-size:14px;color:var(--ink-soft);line-height:1.6;">' + esc(c.instructor_bio) + "</p>" : "") +
          "</div></div>" : "") +

      reviewsHtml(c);

    initReviewForm(c);

    var firstPreview = null, firstLesson = null;
    (c.curriculum || []).forEach(function (sec, si) {
      (sec.lessons || []).forEach(function (l, li) {
        if (!firstLesson) firstLesson = { si: si, li: li };
        if (!firstPreview && l.preview) firstPreview = { si: si, li: li };
      });
    });
    var previewTarget = firstPreview || firstLesson;
    var previewHref = previewTarget ? "lesson.html?course=" + c.id + "&s=" + previewTarget.si + "&l=" + previewTarget.li : null;

    var off = c.original_price && c.original_price > c.price ? Math.round((1 - c.price / c.original_price) * 100) : 0;
    var inCart = H.cart.has("course", c.id);
    aside.innerHTML =
      '<div class="card" style="overflow:hidden;box-shadow:var(--shadow-md);">' +
        '<div style="aspect-ratio:16/9;background:' + esc(c.icon_bg) + ';display:flex;align-items:center;justify-content:center;position:relative;">' +
          (previewHref
            ? '<a href="' + previewHref + '" aria-label="Play preview" style="width:56px;height:56px;border-radius:999px;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;color:var(--accent-strong);">' + PLAY + "</a>" +
              '<a href="' + previewHref + '" style="position:absolute;bottom:10px;left:12px;font-size:12px;color:#fff;background:rgba(20,20,20,0.55);padding:3px 8px;border-radius:6px;">Preview this course</a>'
            : "") +
          H.heartButton(c.id, "position:absolute;top:10px;right:10px;") +
        "</div>" +
        '<div style="padding:24px;">' +
          '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:20px;">' +
            '<span style="font-size:30px;font-weight:700;font-family:var(--font-display);">' + money(c.price) + "</span>" +
            (off ? '<span style="font-size:15px;color:var(--ink-faint);text-decoration:line-through;">' + money(c.original_price) + "</span>" +
                   '<span class="badge" style="background:var(--danger-tint);color:var(--danger);">' + off + "% off</span>" : "") +
          "</div>" +
          (c.enrolled
            ? '<a href="' + (previewHref || "lesson.html?course=" + c.id) + '" class="btn btn-primary btn-block" style="margin-bottom:20px;">' + (c.progress && c.progress.length ? "Continue learning" : "Start learning") + "</a>"
            : c.price === 0
              ? '<button class="btn btn-primary btn-block" style="margin-bottom:20px;" data-enrol-free>Enrol for free</button>'
              : '<button class="btn btn-secondary btn-block" style="margin-bottom:10px;' + (inCart ? "color:var(--success);border-color:var(--success);" : "") + '" data-cart-toggle>' + (inCart ? "Added to cart" : "Add to cart") + "</button>" +
                '<a href="cart.html" class="btn btn-primary btn-block" style="margin-bottom:20px;" data-buy-now>Buy now</a>') +
          (c.can_manage ? '<a href="course-upload.html?id=' + c.id + '" class="btn btn-secondary btn-block btn-sm" style="margin-bottom:16px;">Edit course</a>' : "") +
          '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-soft);margin-bottom:20px;">' + LOCK + " 30-day money-back guarantee</div>" +
          '<div style="border-top:1px solid var(--border);padding-top:18px;display:flex;flex-direction:column;gap:10px;">' +
            '<div style="font-size:13px;font-weight:600;margin-bottom:2px;">This course includes:</div>' +
            (totals.seconds ? '<div style="font-size:13px;color:var(--ink-soft);">· ' + totals.label + " on-demand video</div>" : "") +
            (c.resources ? '<div style="font-size:13px;color:var(--ink-soft);">· ' + num(c.resources) + " downloadable resource" + (c.resources === 1 ? "" : "s") + "</div>" : "") +
            '<div style="font-size:13px;color:var(--ink-soft);">· Certificate of completion</div>' +
            '<div style="font-size:13px;color:var(--ink-soft);">· Full lifetime access</div>' +
            '<div style="font-size:13px;color:var(--ink-soft);">· Access on mobile and desktop</div>' +
          "</div></div></div>";

    // Curriculum accordion (own handler: this markup is rendered after script.js has bound its accordions)
    main.querySelectorAll("[data-acc-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        var panel = main.querySelector('[data-acc-panel="' + btn.getAttribute("data-acc-toggle") + '"]');
        if (panel) panel.classList.toggle("hide", !open);
        var chev = btn.querySelector(".chev");
        if (chev) chev.style.transform = open ? "rotate(180deg)" : "";
      });
    });

    var enrolBtn = aside.querySelector("[data-enrol-free]");
    if (enrolBtn) enrolBtn.addEventListener("click", async function () {
      var user = await H.session.get();
      if (!user) return H.session.requireLogin();
      enrolBtn.disabled = true;
      try { await H.api.enrol(c.id); H.toast("You’re enrolled!"); location.href = "lesson.html?course=" + c.id; }
      catch (e) { H.toast(e.message); enrolBtn.disabled = false; }
    });
    var cartBtn = aside.querySelector("[data-cart-toggle]");
    if (cartBtn) cartBtn.addEventListener("click", function () {
      if (H.cart.has("course", c.id)) {
        H.cart.remove("course-" + c.id);
        cartBtn.textContent = "Add to cart"; cartBtn.style.color = ""; cartBtn.style.borderColor = "";
      } else {
        H.cart.add("course", c);
        cartBtn.textContent = "Added to cart"; cartBtn.style.color = "var(--success)"; cartBtn.style.borderColor = "var(--success)";
      }
    });
    var buy = aside.querySelector("[data-buy-now]");
    if (buy) buy.addEventListener("click", function () { H.cart.add("course", c); });
  }

  var AVATARS = [["#E3F1FB", "#3E93C9"], ["#E4F3EA", "#3E9C6B"], ["#FDEEDC", "#C98A3E"], ["#FBE7EC", "#C9698A"], ["#EDEBFB", "#7A6DF0"]];
  function reviewsHtml(c) {
    var list = (c.reviews || []).map(function (r, i) {
      var col = AVATARS[i % AVATARS.length];
      return '<div style="padding-bottom:18px;border-bottom:1px solid var(--border);">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:32px;height:32px;border-radius:999px;background:' + col[0] + ";color:" + col[1] + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">' + esc(H.initials(r.name)) + "</div>" +
            '<span style="font-size:13px;font-weight:600;">' + esc(r.name) + "</span>" +
            (r.verified ? '<span class="badge badge-success">Enrolled</span>' : "") + "</div>" +
          H.stars(r.rating) +
        "</div>" +
        '<p style="font-size:14px;color:var(--ink-soft);line-height:1.6;">“' + esc(r.body) + "”</p></div>";
    }).join("");
    return '<div id="reviews">' +
      '<h3 style="font-size:18px;margin-bottom:18px;">Student reviews</h3>' +
      '<div style="display:flex;flex-direction:column;gap:18px;margin-bottom:28px;">' +
        (list || '<p style="font-size:14px;color:var(--ink-faint);">No reviews yet — be the first.</p>') +
      "</div>" +
      '<form class="card" style="padding:24px;display:flex;flex-direction:column;gap:16px;" data-review-form novalidate>' +
        '<h4 style="font-size:16px;">Leave a review</h4>' +
        '<div class="notice notice-success hide" data-review-done>Thanks! Your review will appear once it’s been approved.</div>' +
        '<div class="notice notice-error hide" data-review-error></div>' +
        '<div data-review-signin class="hide" style="font-size:14px;color:var(--ink-soft);"><a href="login.html?next=course-detail.html%3Fid%3D' + c.id + '" style="color:var(--accent-strong);font-weight:600;">Sign in</a> to leave a review.</div>' +
        '<div data-review-fields style="display:flex;flex-direction:column;gap:16px;">' +
          '<div><label for="rv-rating">Rating</label><select id="rv-rating" name="rating" class="input" style="max-width:260px;">' +
            '<option value="">Choose…</option><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Okay</option><option value="2">2 — Poor</option><option value="1">1 — Terrible</option></select></div>' +
          '<div><label for="rv-body">Review</label><textarea id="rv-body" name="body" class="input" rows="4" maxlength="2000" placeholder="What did you build? What could be better?"></textarea></div>' +
          '<div><button type="submit" class="btn btn-primary btn-sm">Submit review</button></div>' +
        "</div>" +
      "</form></div>";
  }

  function initReviewForm(c) {
    var form = main.querySelector("[data-review-form]");
    if (!form) return;
    H.session.get().then(function (u) {
      form.querySelector("[data-review-signin]").classList.toggle("hide", !!u);
      form.querySelector("[data-review-fields]").classList.toggle("hide", !u);
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errBox = form.querySelector("[data-review-error]");
      errBox.classList.add("hide");
      var ok = H.validate(form, {
        rating: H.rules.required("A rating"),
        body: H.rules.minLength(10, "Your review"),
      });
      if (!ok) return;
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await H.api.submitReview({ course_id: c.id, rating: Number(form.rating.value), body: form.body.value.trim() });
        form.reset();
        form.querySelector("[data-review-done]").classList.remove("hide");
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hide");
      } finally {
        btn.disabled = false;
      }
    });
  }

  function notFound() {
    document.title = "Course not found — Coursehub";
    main.innerHTML = '<h1 style="font-size:28px;margin-bottom:12px;">Course not found</h1>' +
      '<p style="font-size:15px;color:var(--ink-soft);margin-bottom:24px;">It may have been removed or unpublished.</p>' +
      '<a href="index.html" class="btn btn-secondary">Browse courses</a>';
    aside.innerHTML = "";
  }

  var id = H.getParam("id");
  if (!id) return notFound();
  H.api.course(id).then(render).catch(function (e) {
    if (e.status === 404) notFound();
    else main.innerHTML = '<p style="color:var(--ink-faint);font-size:14px;">Couldn’t load this course right now. Please try again in a moment.</p>';
  });
})();
