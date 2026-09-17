/* Page-specific behaviour from the design handoff (sidebar titles, sample-data
   interactions). Moved out of the HTML so the Content Security Policy can
   forbid inline scripts. */
  document.addEventListener('DOMContentLoaded', function () {
    /* Sidebar tabs also update the page title and active state */
    var navButtons = document.querySelectorAll('[data-tab-group="dashboard"][data-tab]');
    var titleEl = document.getElementById('dash-title');
    navButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (titleEl) titleEl.textContent = btn.getAttribute('data-tab-title');
      });
    });

    /* My Courses status filter */
    var filterBtns = document.querySelectorAll('[data-course-filter]');
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
        var status = btn.getAttribute('data-course-filter');
        document.querySelectorAll('[data-course-row]').forEach(function (row) {
          var show = status === 'All' || row.getAttribute('data-status') === status;
          row.classList.toggle('hide', !show);
        });
      });
    });

  });
