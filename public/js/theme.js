// Dark/light theme toggle - persists choice in localStorage, works with the
// inline init script in the layout head (which sets the initial attribute
// before first paint to avoid a flash of the wrong theme).
(function () {
  function apply(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var current = document.documentElement.getAttribute('data-bs-theme') || 'light';
    apply(current);

    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('trafo360-theme', next); } catch (e) {}
        // Reload rather than live-swap: pages with Chart.js canvases pick
        // their palette once at render time (see views/analytics.ejs) and
        // don't re-color live, so a reload keeps everything in sync.
        if (document.querySelector('canvas')) {
          window.location.reload();
        } else {
          apply(next);
        }
      });
    });
  });
})();
