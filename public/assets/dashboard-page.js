/* Sidebar tab → page title (from the design handoff). Data behaviour lives in dashboard.js. */
document.addEventListener('DOMContentLoaded', function () {
  var titleEl = document.getElementById('dash-title');
  document.querySelectorAll('[data-tab-group="dashboard"][data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (titleEl) titleEl.textContent = btn.getAttribute('data-tab-title');
    });
  });
});
