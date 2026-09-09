// Toggles a list page between its table view and a card/grid view,
// remembering the choice per page in localStorage. Wire up with:
//   <div data-view-toggle="jobs" data-view-table="jobsTable" data-view-grid="jobsGrid">
//     <button data-view-mode="table">...</button>
//     <button data-view-mode="grid">...</button>
//   </div>
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-view-toggle]').forEach(function (group) {
      var key = 'trafo360-view-' + group.getAttribute('data-view-toggle');
      var tableEl = document.getElementById(group.getAttribute('data-view-table'));
      var gridEl = document.getElementById(group.getAttribute('data-view-grid'));
      if (!tableEl || !gridEl) return;

      function apply(mode) {
        tableEl.hidden = mode === 'grid';
        gridEl.hidden = mode !== 'grid';
        group.querySelectorAll('button').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-view-mode') === mode);
        });
      }

      var saved = 'table';
      try { saved = localStorage.getItem(key) || 'table'; } catch (e) {}
      apply(saved);

      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var mode = b.getAttribute('data-view-mode');
          try { localStorage.setItem(key, mode); } catch (e) {}
          apply(mode);
        });
      });
    });
  });
})();
