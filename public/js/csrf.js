// Injects the CSRF token (from the <meta name="csrf-token"> tag the layout
// renders) into every same-page POST form as a hidden field, so no
// individual .ejs view has to be edited to carry it.
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta) return;
  var token = meta.getAttribute('content');
  if (!token) return;

  function inject(form) {
    if (!form.querySelector('input[name="_csrf"]')) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = token;
      form.appendChild(input);
    }
  }

  document.querySelectorAll('form').forEach(function (form) {
    if ((form.method || 'get').toUpperCase() === 'POST') inject(form);
  });

  // Forms injected dynamically after page load (e.g. modals built with JS)
  // still get covered, since the token is also attached just-in-time here.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.tagName === 'FORM' && (form.method || 'get').toUpperCase() === 'POST') {
      inject(form);
    }
  }, true);
})();
