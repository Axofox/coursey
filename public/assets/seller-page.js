/* Page-specific behaviour from the design handoff (sidebar titles, sample-data
   interactions). Moved out of the HTML so the Content Security Policy can
   forbid inline scripts. */
  document.addEventListener('DOMContentLoaded', function () {
    var navButtons = document.querySelectorAll('[data-tab-group="seller"][data-tab]');
    var titleEl = document.getElementById('seller-title');
    navButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (titleEl) titleEl.textContent = btn.getAttribute('data-tab-title');
      });
    });
  });
