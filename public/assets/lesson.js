/* Lesson player — lesson.html?course=N&s=<section>&l=<lesson>
   Until accounts and purchases exist, only lessons flagged "preview" (and every
   lesson of a free course) can be played; the rest show an unlock prompt. */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var main = document.querySelector("[data-lesson-main]");
  var list = document.querySelector("[data-lesson-list]");
  var crumb = document.querySelector("[data-breadcrumb]");
  if (!main) return;

  var PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"></circle><polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"></polygon></svg>';
  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

  var courseId = Number(H.getParam("course"));
  var course, flat = [];
  // Progress lives on the server for enrolled accounts; anonymous preview watching stays in this browser.
  var progressKey = "coursehub-progress-" + courseId;
  var serverProgress = null;
  function progress() {
    if (serverProgress) return serverProgress;
    try { return JSON.parse(localStorage.getItem(progressKey) || "[]"); } catch (e) { return []; }
  }
  function markDone(key, si, li) {
    var p = progress();
    if (p.indexOf(key) === -1) {
      p.push(key);
      if (serverProgress) {
        H.api.progress(courseId, si, li).then(function (r) {
          if (r.certificate_id) H.toast("🎓 Course complete — your certificate is ready in My learning.");
        }).catch(function () {});
      } else {
        try { localStorage.setItem(progressKey, JSON.stringify(p)); } catch (e) {}
      }
    }
  }

  function canPlay(lesson) { return course.enrolled || course.can_manage || course.price === 0 || lesson.preview === true; }

  // YouTube / Vimeo links become embeds; direct media files use <video>
  function playerHtml(url) {
    var yt = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url);
    if (yt) return '<iframe src="https://www.youtube-nocookie.com/embed/' + yt[1] + '" title="Lesson video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    var vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
    if (vm) return '<iframe src="https://player.vimeo.com/video/' + vm[1] + '" title="Lesson video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    if (/\.(mp4|webm|m4v|mov)(\?|$)/i.test(url)) return '<video controls playsinline src="' + esc(url) + '"></video>';
    return '<div class="player-locked"><p style="font-size:14px;margin-bottom:12px;">This lesson’s video is hosted elsewhere.</p><a class="btn btn-primary btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Open video</a></div>';
  }

  function renderLesson(si, li) {
    var item = flat.find(function (f) { return f.si === si && f.li === li; }) || flat[0];
    if (!item) {
      main.innerHTML = '<h1 style="font-size:24px;">This course has no lessons yet.</h1>';
      return;
    }
    var idx = flat.indexOf(item);
    var prev = flat[idx - 1], next = flat[idx + 1];
    var l = item.lesson;
    var playable = canPlay(l);
    document.title = l.title + " — " + course.title + " — Coursehub";
    history.replaceState(null, "", "lesson.html?course=" + courseId + "&s=" + item.si + "&l=" + item.li);
    if (playable) markDone(item.si + "-" + item.li, item.si, item.li);

    var inCart = H.cart.has("course", course.id);
    main.innerHTML =
      '<div class="player">' +
        (playable
          ? (l.video_url ? playerHtml(l.video_url)
             : '<div class="player-locked"><p style="font-size:14px;">No video has been attached to this lesson yet.</p></div>')
          : '<div class="player-locked">' + LOCK +
              '<h2 style="font-size:18px;margin:10px 0 6px;color:#fff;">Unlock this lesson</h2>' +
              '<p style="font-size:13px;color:#C8C8CC;margin-bottom:16px;">Buy the course to watch all ' + flat.length + ' lessons. Lessons marked Preview are free to watch.</p>' +
              '<button class="btn btn-primary btn-sm" data-cart-toggle>' + (inCart ? "In your cart — go to checkout" : "Add to cart — " + H.money(course.price)) + "</button>" +
              '<p style="font-size:12px;color:#8A8A90;margin-top:12px;">Already bought it? <a href="login.html?next=lesson.html%3Fcourse%3D' + course.id + '" style="color:#fff;text-decoration:underline;">Sign in</a></p>' +
            "</div>") +
      "</div>" +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:24px 0 8px;flex-wrap:wrap;">' +
        "<div>" +
          '<div style="font-size:12px;color:var(--ink-faint);margin-bottom:4px;">Section ' + (item.si + 1) + " · " + esc(course.curriculum[item.si].title) + "</div>" +
          '<h1 style="font-size:24px;line-height:1.25;">' + esc(l.title) + "</h1>" +
        "</div>" +
        (l.duration ? '<span class="badge badge-neutral">' + esc(l.duration) + "</span>" : "") +
      "</div>" +
      '<p style="font-size:14px;color:var(--ink-soft);margin-bottom:24px;">Part of <a href="course-detail.html?id=' + course.id + '" style="color:var(--accent-strong);font-weight:600;">' + esc(course.title) + "</a>" +
        (course.instructor_name ? " by " + esc(course.instructor_name) : "") + "</p>" +
      '<div style="display:flex;justify-content:space-between;gap:10px;">' +
        (prev ? '<button class="btn btn-secondary btn-sm" data-goto="' + prev.si + "," + prev.li + '">← Previous</button>' : "<span></span>") +
        (next ? '<button class="btn btn-primary btn-sm" data-goto="' + next.si + "," + next.li + '">Next lesson →</button>'
              : '<a class="btn btn-primary btn-sm" href="course-detail.html?id=' + course.id + '#reviews">Finished — leave a review</a>') +
      "</div>";

    main.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-goto").split(",").map(Number);
        renderLesson(p[0], p[1]);
        renderList(p[0], p[1]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    var cartBtn = main.querySelector("[data-cart-toggle]");
    if (cartBtn) cartBtn.addEventListener("click", function () {
      if (!H.cart.has("course", course.id)) H.cart.add("course", course);
      location.href = "cart.html";
    });
  }

  function renderList(si, li) {
    var done = progress();
    var totals = H.curriculumTotals(course.curriculum);
    list.innerHTML =
      '<div style="padding:12px 14px 4px;">' +
        '<div style="font-size:14px;font-weight:600;">' + esc(course.title) + "</div>" +
        '<div style="font-size:12px;color:var(--ink-faint);margin:4px 0 8px;">' + done.length + " of " + totals.lessons + " lessons watched</div>" +
        '<div class="progress-track"><div class="progress-fill" style="width:' + (totals.lessons ? Math.round(done.length / totals.lessons * 100) : 0) + '%;"></div></div>' +
      "</div>" +
      course.curriculum.map(function (s, i) {
        return '<div class="section-title">' + (i + 1) + ". " + esc(s.title) + "</div>" +
          s.lessons.map(function (l, j) {
            var active = i === si && j === li;
            var playable = canPlay(l);
            return '<button class="lesson' + (active ? " active" : "") + (done.indexOf(i + "-" + j) !== -1 ? " done" : "") + '" data-goto="' + i + "," + j + '">' +
              '<span class="dot"></span><span style="flex-grow:1;min-width:0;">' + esc(l.title) + "</span>" +
              (playable ? (l.preview && course.price !== 0 ? '<span class="badge badge-accent">Preview</span>' : "") : LOCK) +
              (l.duration ? '<span class="len">' + esc(l.duration) + "</span>" : "") +
            "</button>";
          }).join("");
      }).join("");
    list.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-goto").split(",").map(Number);
        renderLesson(p[0], p[1]);
        renderList(p[0], p[1]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function notFound(msg) {
    main.innerHTML = '<h1 style="font-size:28px;margin-bottom:12px;">' + esc(msg || "Course not found") + "</h1>" +
      '<a href="index.html" class="btn btn-secondary">Browse courses</a>';
    list.innerHTML = "";
  }

  if (!courseId) return notFound();
  H.api.course(courseId).then(function (c) {
    course = c;
    if (c.enrolled) serverProgress = (c.progress || []).slice();
    (c.curriculum || []).forEach(function (s, si) {
      (s.lessons || []).forEach(function (l, li) { flat.push({ si: si, li: li, lesson: l }); });
    });
    crumb.insertAdjacentHTML("beforeend", '<span>/</span><a href="course-detail.html?id=' + c.id + '" style="color:var(--ink-faint);">' + esc(c.title) + "</a>");
    var si = Number(H.getParam("s")) || 0, li = Number(H.getParam("l")) || 0;
    renderLesson(si, li);
    renderList(si, li);
  }).catch(function (e) {
    notFound(e.status === 404 ? "Course not found" : "Couldn’t load this course right now");
  });
})();
