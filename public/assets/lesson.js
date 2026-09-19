/* Lesson player — lesson.html?course=N&s=<section>&l=<lesson>  (or &step=<k> in plan mode)

   Two modes:
   - Classic: walks the lessons. Only free-preview lessons (and every lesson of a
     free course) play for visitors; enrolled learners get everything.
   - Plan (courses with the learner_setup flag, enrolled learners only): walks the
     personalised plan from /api/learn — lessons plus checkpoints, exercises and
     spaced reviews chosen by the learner's settings. Sends learners without
     settings to the setup screen first. */
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
  function markDone(key, si, li, then) {
    var p = progress();
    if (p.indexOf(key) !== -1) return;
    p.push(key);
    if (serverProgress) {
      H.api.progress(courseId, si, li).then(function (r) {
        if (r.certificate_id) H.toast("🎓 Course complete — your certificate is ready in My learning.");
        if (then) then();
      }).catch(function () {});
    } else {
      try { localStorage.setItem(progressKey, JSON.stringify(p)); } catch (e) {}
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

  function lessonBody(l, si) {
    var playable = canPlay(l);
    var inCart = H.cart.has("course", course.id);
    return '<div class="player">' +
        (playable
          ? (l.video_url && l.video_url !== "locked" ? playerHtml(l.video_url)
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
          '<div style="font-size:12px;color:var(--ink-faint);margin-bottom:4px;">Section ' + (si + 1) + " · " + esc(course.curriculum[si].title) + "</div>" +
          '<h1 style="font-size:24px;line-height:1.25;">' + esc(l.title) + "</h1>" +
        "</div>" +
        (l.duration ? '<span class="badge badge-neutral">' + esc(l.duration) + "</span>" : "") +
      "</div>" +
      '<p style="font-size:14px;color:var(--ink-soft);margin-bottom:24px;">Part of <a href="course-detail.html?id=' + course.id + '" style="color:var(--accent-strong);font-weight:600;">' + esc(course.title) + "</a>" +
        (course.instructor_name ? " by " + esc(course.instructor_name) : "") + "</p>";
  }

  function bindCart(container) {
    var cartBtn = container.querySelector("[data-cart-toggle]");
    if (cartBtn) cartBtn.addEventListener("click", function () {
      if (!H.cart.has("course", course.id)) H.cart.add("course", course);
      location.href = "cart.html";
    });
  }

  /* =====================================================================
     Classic mode
     ===================================================================== */
  function renderLesson(si, li) {
    var item = flat.find(function (f) { return f.si === si && f.li === li; }) || flat[0];
    if (!item) { main.innerHTML = '<h1 style="font-size:24px;">This course has no lessons yet.</h1>'; return; }
    var idx = flat.indexOf(item);
    var prev = flat[idx - 1], next = flat[idx + 1];
    document.title = item.lesson.title + " — " + course.title + " — Coursehub";
    history.replaceState(null, "", "lesson.html?course=" + courseId + "&s=" + item.si + "&l=" + item.li);
    if (canPlay(item.lesson)) markDone(item.si + "-" + item.li, item.si, item.li);

    main.innerHTML = lessonBody(item.lesson, item.si) +
      '<div style="display:flex;justify-content:space-between;gap:10px;">' +
        (prev ? '<button class="btn btn-secondary btn-sm" data-goto="' + prev.si + "," + prev.li + '">← Previous</button>' : "<span></span>") +
        (next ? '<button class="btn btn-primary btn-sm" data-goto="' + next.si + "," + next.li + '">Next lesson →</button>'
              : '<a class="btn btn-primary btn-sm" href="course-detail.html?id=' + course.id + '#reviews">Finished — leave a review</a>') +
      "</div>";
    main.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-goto").split(",").map(Number);
        renderLesson(p[0], p[1]); renderList(p[0], p[1]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    bindCart(main);
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
        renderLesson(p[0], p[1]); renderList(p[0], p[1]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  /* =====================================================================
     Plan mode (learner setup)
     ===================================================================== */
  var plan = null; // state from /api/learn: { settings, plan, streak, nudge, completed, options }
  var stepIdx = 0;

  function refreshPlan() {
    return H.api.learn(courseId).then(function (s) { plan = s; renderPlanList(); return s; }).catch(function () {});
  }

  function stepLabel(step) {
    return { lesson: "Lesson", checkpoint: "Checkpoint", review: "Review", exercise: "Exercise" }[step.type];
  }

  function navButtons() {
    var steps = plan.plan;
    var prev = stepIdx > 0 ? stepIdx - 1 : null;
    var next = stepIdx < steps.length - 1 ? stepIdx + 1 : null;
    return '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:24px;">' +
      (prev !== null ? '<button class="btn btn-secondary btn-sm" data-step="' + prev + '">← Previous</button>' : "<span></span>") +
      (next !== null ? '<button class="btn btn-primary btn-sm" data-step="' + next + '">Next: ' + esc(stepLabel(steps[next])) + " →</button>"
                     : '<a class="btn btn-primary btn-sm" href="course-detail.html?id=' + course.id + '#reviews">Finished — leave a review</a>') +
      "</div>";
  }

  function quizHtml(step) {
    var isReview = step.type === "review";
    return '<div class="card" style="padding:28px;">' +
      '<div class="badge ' + (isReview ? "badge-amber" : "badge-accent") + '" style="margin-bottom:12px;">' + (isReview ? "Spaced review" : "Checkpoint") + "</div>" +
      '<h1 style="font-size:22px;margin-bottom:6px;">' + esc(step.title) + "</h1>" +
      '<p style="font-size:14px;color:var(--ink-soft);margin-bottom:8px;">' + (isReview
        ? "A few questions from earlier sections (" + step.sources.map(function (s) { return esc(course.curriculum[s].title); }).join(", ") + "). Recalling older material is what makes it stick — no score pressure."
        : "Low-stakes: " + step.questions.length + " quick question" + (step.questions.length === 1 ? "" : "s") + " on this section. Wrong answers come back later.") + "</p>" +
      (step.done ? '<div class="notice notice-success" style="margin-bottom:8px;">You’ve done this one. Answer again if you like — it still counts as practice.</div>' : "") +
      '<form data-quiz novalidate>' +
        step.questions.map(function (q, qi) {
          return '<div class="quiz-q" data-q="' + qi + '">' +
            '<div style="font-size:15px;font-weight:600;margin-bottom:6px;">' + (qi + 1) + ". " + esc(q.prompt) + "</div>" +
            q.options.map(function (o, oi) {
              return '<label class="quiz-opt"><input type="radio" name="q' + qi + '" value="' + oi + '" style="margin-top:3px;"> <span>' + esc(o) + "</span></label>";
            }).join("") +
            '<div class="field-error" data-q-error style="display:none;">Pick an answer.</div>' +
            '<div class="notice hide" data-q-explain style="margin-top:8px;"></div>' +
          "</div>";
        }).join("") +
        '<div style="display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap;">' +
          '<button type="submit" class="btn btn-primary btn-sm">Check answers</button>' +
          '<span data-quiz-result style="font-size:14px;font-weight:600;"></span>' +
        "</div>" +
      "</form></div>";
  }

  function exerciseHtml(step) {
    var ex = step.exercise;
    var trackName = plan.options.track[plan.settings.track].label;
    return '<div class="card" style="padding:28px;">' +
      '<div class="badge badge-neutral" style="margin-bottom:12px;">Exercise · ' + esc(trackName) + " track</div>" +
      '<h1 style="font-size:22px;margin-bottom:10px;">' + esc(ex.title) + "</h1>" +
      '<p style="font-size:15px;color:var(--ink-soft);line-height:1.7;white-space:pre-line;margin-bottom:20px;">' + esc(ex.body) + "</p>" +
      (step.done
        ? '<div class="notice notice-success">Marked done.</div>'
        : '<button class="btn btn-secondary btn-sm" data-exercise-done>Mark as done</button>') +
      "</div>";
  }

  function renderStep(k) {
    var steps = plan.plan;
    if (!steps.length) { main.innerHTML = '<h1 style="font-size:24px;">This course has no content yet.</h1>'; return; }
    stepIdx = Math.max(0, Math.min(k, steps.length - 1));
    var step = steps[stepIdx];
    history.replaceState(null, "", "lesson.html?course=" + courseId + "&step=" + stepIdx);
    document.title = step.title + " — " + course.title + " — Coursehub";

    var banner = plan.nudge
      ? '<div class="notice" style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px;' + (plan.nudge.tone === "done" ? "background:var(--success-tint);color:var(--success);" : "") + '"><span>' + esc(plan.nudge.text) + "</span>" +
        (plan.streak.streak ? '<span class="streak-pill">🔥 ' + plan.streak.streak + "-day streak</span>" : "") + "</div>"
      : "";

    if (step.type === "lesson") {
      var lesson = course.curriculum[step.si].lessons[step.li];
      markDone(step.si + "-" + step.li, step.si, step.li, refreshPlan);
      main.innerHTML = banner + lessonBody(lesson, step.si) + navButtons();
      bindCart(main);
    } else if (step.type === "checkpoint" || step.type === "review") {
      main.innerHTML = banner + quizHtml(step) + navButtons();
      bindQuiz(step);
    } else if (step.type === "exercise") {
      main.innerHTML = banner + exerciseHtml(step) + navButtons();
      var doneBtn = main.querySelector("[data-exercise-done]");
      if (doneBtn) doneBtn.addEventListener("click", async function () {
        doneBtn.disabled = true;
        try { plan = await H.api.learnExercise(courseId, step.si); renderPlanList(); renderStep(stepIdx); H.toast("Nice — exercise done."); }
        catch (e) { H.toast(e.message); doneBtn.disabled = false; }
      });
    }
    main.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () { renderStep(Number(b.dataset.step)); renderPlanList(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    });
  }

  function bindQuiz(step) {
    var form = main.querySelector("[data-quiz]");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var answers = [];
      var ok = true;
      step.questions.forEach(function (q, qi) {
        var chosen = form.querySelector('input[name="q' + qi + '"]:checked');
        var err = form.querySelector('[data-q="' + qi + '"] [data-q-error]');
        err.style.display = chosen ? "none" : "";
        if (!chosen) ok = false; else answers.push({ section_idx: q.section_idx, q_idx: q.q_idx, choice: Number(chosen.value) });
      });
      if (!ok) return;
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        var r = await H.api.learnQuiz(courseId, step.type, step.si, answers);
        plan = r.state;
        r.results.forEach(function (res, qi) {
          var box = form.querySelector('[data-q="' + qi + '"]');
          box.querySelectorAll(".quiz-opt").forEach(function (opt, oi) {
            opt.classList.toggle("right", oi === res.answer);
            opt.classList.toggle("wrong", oi === res.choice && !res.correct);
            opt.querySelector("input").disabled = true;
          });
          var ex = box.querySelector("[data-q-explain]");
          ex.textContent = (res.correct ? "Correct. " : "Not quite — the answer is “" + step.questions[qi].options[res.answer] + "”. ") + (res.explanation || "");
          ex.classList.remove("hide");
        });
        form.querySelector("[data-quiz-result]").textContent = r.score + " / " + r.total + (r.score === r.total ? " — all correct" : r.score >= r.total / 2 ? " — solid" : " — these will come back later");
        btn.textContent = "Checked";
        renderPlanList();
      } catch (err) {
        H.toast(err.message); btn.disabled = false;
      }
    });
  }

  function renderPlanList() {
    var steps = plan.plan;
    var lessons = steps.filter(function (s) { return s.type === "lesson"; });
    var doneLessons = lessons.filter(function (s) { return s.done; }).length;
    var nextUndone = steps.findIndex(function (s) { return !s.done; });
    list.innerHTML =
      '<div style="padding:12px 14px 4px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
          '<div style="font-size:14px;font-weight:600;">' + esc(course.title) + "</div>" +
          (plan.settings.pace === "sprint" && plan.streak.streak ? '<span class="streak-pill" title="Days in a row with activity">🔥 ' + plan.streak.streak + "</span>" : "") +
        "</div>" +
        '<div style="font-size:12px;color:var(--ink-faint);margin:4px 0 8px;">' + doneLessons + " of " + lessons.length + " lessons · " +
          esc(plan.options.pace[plan.settings.pace].label) + " · " + esc(plan.options.practice[plan.settings.practice].label) + " practice · " + esc(plan.options.track[plan.settings.track].label) +
          ' <a href="setup.html?course=' + courseId + '" style="color:var(--accent-strong);font-weight:600;">Change</a></div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + (lessons.length ? Math.round(doneLessons / lessons.length * 100) : 0) + '%;"></div></div>' +
      "</div>" +
      course.curriculum.map(function (s, i) {
        return '<div class="section-title">' + (i + 1) + ". " + esc(s.title) + "</div>" +
          steps.map(function (st, k) {
            if (st.si !== i) return "";
            var isLesson = st.type === "lesson";
            var label = isLesson ? course.curriculum[st.si].lessons[st.li].title : st.title;
            return '<button class="lesson step-' + st.type + (k === stepIdx ? " active" : "") + (st.done ? " done" : "") + '" data-step="' + k + '">' +
              '<span class="dot"></span><span style="flex-grow:1;min-width:0;">' + esc(label) + "</span>" +
              (isLesson ? (st.duration ? '<span class="len">' + esc(st.duration) + "</span>" : "") : '<span class="len">' + esc(stepLabel(st)) + "</span>") +
            "</button>";
          }).join("");
      }).join("") +
      (nextUndone === -1 ? '<div style="padding:14px;font-size:12px;color:var(--success);font-weight:600;">Everything done 🎉</div>' : "");
    list.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () { renderStep(Number(b.dataset.step)); renderPlanList(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    });
  }

  function startPlanMode(state) {
    plan = state;
    var steps = state.plan;
    var wanted = H.getParam("step");
    var k;
    if (wanted !== null) k = Number(wanted);
    else if (H.getParam("s") !== null) {
      var si = Number(H.getParam("s")) || 0, li = Number(H.getParam("l")) || 0;
      k = steps.findIndex(function (s) { return s.type === "lesson" && s.si === si && s.li === li; });
    } else k = steps.findIndex(function (s) { return !s.done; });
    if (k < 0) k = 0;
    renderStep(k);
    renderPlanList();
    if (state.nudge) H.api.event("nudge_shown", courseId, { tone: state.nudge.tone });
  }

  /* ---------- Boot ---------- */
  function notFound(msg) {
    main.innerHTML = '<h1 style="font-size:28px;margin-bottom:12px;">' + esc(msg || "Course not found") + "</h1>" +
      '<a href="index.html" class="btn btn-secondary">Browse courses</a>';
    list.innerHTML = "";
  }

  if (!courseId) return notFound();
  H.api.course(courseId).then(async function (c) {
    course = c;
    if (c.enrolled) serverProgress = (c.progress || []).slice();
    (c.curriculum || []).forEach(function (s, si) {
      (s.lessons || []).forEach(function (l, li) { flat.push({ si: si, li: li, lesson: l }); });
    });
    crumb.insertAdjacentHTML("beforeend", '<span>/</span><a href="course-detail.html?id=' + c.id + '" style="color:var(--ink-faint);">' + esc(c.title) + "</a>");

    if (c.enrolled && c.features && c.features.learner_setup) {
      if (c.needs_setup) { location.replace("setup.html?course=" + c.id); return; }
      try {
        var state = await H.api.learn(c.id);
        if (state.settings) return startPlanMode(state);
      } catch (e) { /* fall through to the classic player */ }
    }
    var si = Number(H.getParam("s")) || 0, li = Number(H.getParam("l")) || 0;
    renderLesson(si, li);
    renderList(si, li);
  }).catch(function (e) {
    notFound(e.status === 404 ? "Course not found" : "Couldn’t load this course right now");
  });
})();
