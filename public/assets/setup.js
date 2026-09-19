/* Learner setup — a character-select screen for three settings stored per enrolment.
   setup.html?course=N  (only works for courses with the learner_setup flag) */
(function () {
  "use strict";
  var H = window.Coursehub;
  var esc = H.esc;
  var root = document.querySelector("[data-setup]");
  if (!root) return;
  var courseId = Number(H.getParam("course"));

  // Presentation for each option. Meaning lives on the server (options.*.tagline).
  var CARDS = {
    pace: {
      sprint:   { icon: "⚡", bg: "#FBE7EC", color: "#C9698A", perks: ["Daily suggested check-in", "Streak counter", "Deadline-driven"] },
      marathon: { icon: "🌱", bg: "#E4F3EA", color: "#3E9C6B", perks: ["Fully self-paced", "No deadlines", "No streak pressure"] },
      cohort:   { icon: "👥", bg: "#E3F1FB", color: "#3E93C9", perks: ["Start with a group", "Shared schedule"], stub: true },
    },
    practice: {
      light: { icon: "🪶", bg: "#FFF6DD", color: "#B79A2E", perks: ["Short checkpoint after each section", "No re-quizzing"] },
      heavy: { icon: "🏋️", bg: "#EDEBFB", color: "#7A6DF0", perks: ["Bigger checkpoints", "Earlier material comes back later", "Spaced repetition"] },
    },
    track: {
      job_ready: { icon: "💼", bg: "#FDEEDC", color: "#C98A3E", perks: ["Applied exercises", "Portfolio deliverables"] },
      project:   { icon: "🛠️", bg: "#E3F1FB", color: "#3E93C9", perks: ["Lighter theory", "Fastest to a working output"] },
      exploring: { icon: "🧭", bg: "#E4F3EA", color: "#3E9C6B", perks: ["Broad overview", "Lowest friction"] },
    },
  };
  var GROUPS = [
    ["pace", "How do you want to pace it?", "You can change any of these later in Settings."],
    ["practice", "How much practice?", "Checkpoints are short, low-stakes quizzes. Recalling material is what makes it stick."],
    ["track", "What are you here for?", "Picks which exercises you see after each section."],
  ];

  function card(group, key, meta) {
    var c = CARDS[group][key];
    var stub = !!(meta.stub || c.stub);
    return '<div class="pick' + (stub ? " stub" : "") + '">' +
      '<input type="radio" name="' + group + '" id="' + group + "-" + key + '" value="' + key + '"' + (stub ? " disabled" : "") + ">" +
      '<label for="' + group + "-" + key + '">' +
        (stub ? '<span class="badge badge-neutral">Coming soon</span>' : "") +
        '<span class="avatar" style="background:' + c.bg + ";color:" + c.color + ';">' + c.icon + "</span>" +
        '<span class="name">' + esc(meta.label) + "</span>" +
        '<span class="tag">' + esc(meta.tagline) + "</span>" +
        '<span class="perks">' + c.perks.map(function (p) { return "<span>· " + esc(p) + "</span>"; }).join("") + "</span>" +
      "</label></div>";
  }

  function render(state, course) {
    var current = state.settings || {};
    document.title = "Set up " + course.title + " — Coursehub";
    root.innerHTML =
      '<div style="text-align:center;margin-bottom:36px;">' +
        '<div class="badge badge-accent" style="margin-bottom:14px;">' + (state.settings ? "Change your setup" : "Before you start") + "</div>" +
        '<h1 style="font-size:34px;line-height:1.15;margin-bottom:10px;">Choose how you’ll take <em style="font-style:normal;color:var(--accent-strong);">' + esc(course.title) + "</em></h1>" +
        '<p style="font-size:15px;color:var(--ink-soft);max-width:520px;margin:0 auto;">Three choices that actually change how the course is delivered to you — pacing, practice and what you’re aiming for.</p>' +
      "</div>" +
      '<form data-setup-form novalidate>' +
        GROUPS.map(function (g) {
          var group = g[0];
          return '<fieldset class="pick-group" style="border:0;padding:0;margin:0 0 36px;">' +
            '<legend style="font-family:var(--font-display);font-size:18px;font-weight:700;margin-bottom:4px;">' + esc(g[1]) + "</legend>" +
            '<p style="font-size:13px;color:var(--ink-faint);margin-bottom:14px;">' + esc(g[2]) + "</p>" +
            '<div class="pick-grid">' + Object.keys(state.options[group]).map(function (k) { return card(group, k, state.options[group][k]); }).join("") + "</div>" +
            '<div class="field-error" data-error-for="' + group + '" style="display:none;"></div>' +
          "</fieldset>";
        }).join("") +
        '<div class="notice notice-error hide" data-setup-error></div>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px;">' +
          '<button type="submit" class="btn btn-primary">' + (state.settings ? "Save and continue" : "Start the course") + "</button>" +
          (state.settings ? '<a class="btn btn-secondary" href="lesson.html?course=' + course.id + '">Cancel</a>' : "") +
        "</div>" +
      "</form>";

    var form = root.querySelector("[data-setup-form]");
    Object.keys(current).forEach(function (k) { var el = form.querySelector('[name="' + k + '"][value="' + current[k] + '"]'); if (el) el.checked = true; });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var settings = {};
      var ok = true;
      GROUPS.forEach(function (g) {
        var chosen = form.querySelector('[name="' + g[0] + '"]:checked');
        var slot = form.querySelector('[data-error-for="' + g[0] + '"]');
        slot.textContent = chosen ? "" : "Pick one to continue.";
        slot.style.display = chosen ? "none" : "";
        if (chosen) settings[g[0]] = chosen.value; else ok = false;
      });
      if (!ok) return;
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await H.api.learnSettings(course.id, settings);
        H.toast(state.settings ? "Setup updated." : "You’re set. Let’s go.");
        location.href = "lesson.html?course=" + course.id;
      } catch (err) {
        var box = root.querySelector("[data-setup-error]");
        box.textContent = err.message; box.classList.remove("hide");
        btn.disabled = false;
      }
    });
  }

  (async function () {
    if (!courseId) { root.innerHTML = "<h1>Course not found</h1>"; return; }
    var user = await H.session.get();
    if (!user) return H.session.requireLogin("setup.html?course=" + courseId);
    try {
      var results = await Promise.all([H.api.learn(courseId), H.api.course(courseId)]);
      render(results[0], results[1]);
      H.api.event("setup_viewed", courseId, { first_time: !results[0].settings });
    } catch (e) {
      if (e.status === 402) { location.replace("course-detail.html?id=" + courseId); return; }
      root.innerHTML = '<h1 style="font-size:24px;margin-bottom:8px;">' + (e.status === 404 ? "This course doesn’t use learner setup" : "Couldn’t load the setup") + '</h1><p><a class="navlink" href="course-detail.html?id=' + courseId + '">Back to the course</a></p>';
    }
  })();
})();
