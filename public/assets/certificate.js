/* Certificate page — public, verifiable by id; "Download" prints to PDF */
(function () {
  "use strict";
  var H = window.Coursehub;
  var box = document.querySelector("[data-certificate]");
  if (!box) return;
  var id = H.getParam("id");
  if (!id) { box.innerHTML = "<h1>Certificate not found</h1>"; return; }
  H.api.certificate(id).then(function (c) {
    document.title = "Certificate \u2014 " + c.course_title + " \u2014 Coursehub";
    var date = new Date(c.issued_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    box.innerHTML =
      '<div class="cert">' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:28px;">' +
          '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="8" style="fill:var(--accent);"></rect><polygon points="11,9 20,14 11,19" style="fill:#fff;"></polygon></svg>' +
          '<span style="font-family:var(--font-display);font-weight:700;font-size:18px;">Coursehub</span></div>' +
        '<div class="label-caps" style="margin-bottom:12px;">Certificate of completion</div>' +
        '<p style="font-size:15px;color:var(--ink-soft);">This certifies that</p>' +
        '<h1 style="font-size:36px;margin:8px 0 12px;">' + H.esc(c.learner_name) + "</h1>" +
        '<p style="font-size:15px;color:var(--ink-soft);">has completed all ' + c.lessons + " lessons of</p>" +
        '<h2 style="font-size:24px;margin:8px 0 20px;">' + H.esc(c.course_title) + "</h2>" +
        (c.instructor_name ? '<p style="font-size:14px;color:var(--ink-soft);">Taught by ' + H.esc(c.instructor_name) + "</p>" : "") +
        '<p style="font-size:14px;color:var(--ink-soft);margin-top:4px;">' + date + "</p>" +
        '<p style="font-size:11px;color:var(--ink-faint);margin-top:28px;">Verify at ' + H.esc(location.origin + location.pathname) + "?id=" + H.esc(c.id) + "</p>" +
      "</div>" +
      '<div class="no-print" style="display:flex;gap:10px;justify-content:center;margin-top:24px;flex-wrap:wrap;">' +
        '<button class="btn btn-primary" data-print>Download / print</button>' +
        '<a class="btn btn-secondary" href="course-detail.html?id=' + c.course_id + '">View course</a>' +
        '<a class="btn btn-secondary" href="dashboard.html?tab=awards">My certificates</a>' +
      "</div>";
    box.querySelector("[data-print]").addEventListener("click", function () { window.print(); });
  }).catch(function (e) {
    box.innerHTML = '<h1 style="font-size:24px;margin-bottom:8px;">' + (e.status === 404 ? "Certificate not found" : "Couldn\u2019t load this certificate") + '</h1><p style="color:var(--ink-soft);">Check the link and try again.</p>';
  });
})();
