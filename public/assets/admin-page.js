/* Page-specific behaviour from the design handoff (sidebar titles, sample-data
   interactions). Moved out of the HTML so the Content Security Policy can
   forbid inline scripts. */
  document.addEventListener('DOMContentLoaded', function () {
    /* Sidebar tab titles */
    var navButtons = document.querySelectorAll('[data-tab-group="admin"][data-tab]');
    var titleEl = document.getElementById('admin-title');
    navButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (titleEl) titleEl.textContent = btn.getAttribute('data-tab-title');
      });
    });


    /* Payouts: approve marks paid and removes the button */
    document.querySelectorAll('[data-payout-approve]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('[data-payout-row]');
        var status = row && row.querySelector('[data-payout-status]');
        if (status) {
          status.textContent = 'Paid';
          status.classList.remove('badge-amber');
          status.classList.add('badge-success');
        }
        btn.remove();
      });
    });

  });
